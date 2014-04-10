var async       = require('async'),
    moment      = require('moment'),
    Base        = require('../Base'),
    validator   = require('validator'),
    Collection  = require('../Collection'),
    AppConfig   = require('../AppConfig');

/**
 * Core method for tracking stats. This method will call Redis.incr method if the passed-in
 * params pass muster, as defined in the configuration file.
 * @param hOpts - Hash containing the following:
 *
 * {
 *  sStat:'' - (required) String name of the stat to be tracked.
 *  Params:? - (required) String or array of parameters used to uniquely identify the item to be tracked (such as the url, user, etc)
 *  oApp:{} - (optional) App object corresponding to the tenant. If not provided, will assign the stat to the default tenant (sid='app')
 *  dDate:{} - (optional) Date object to assign the stat to. Primarily used for back-dated, fake stats in unit testing.
 *  nFakeCount:1 - (optional) Number to count for the stat. Primarily used for fake stats in unit testing.
 *
 * @param fnCallback
 * @param dDate - (optional) date object, if you want to force a date assignment on the stat (unit test, retro-active stat building, etc). Default is now (UTC).
 */
module.exports.track = function(hOpts,fnCallback){
    var dDate = (hOpts && hOpts.dDate) ? moment(hOpts.dDate).utc() : moment.utc();
    var sStat = (hOpts && hOpts.sStat) ? hOpts.sStat : null;
    var Params = (hOpts && hOpts.Params) ? hOpts.Params : null;
    var oApp = (hOpts && hOpts.oApp) ? hOpts.oApp : null;

    var returnError = function(sErr) {
        if (sErr) {
            if (fnCallback)
                fnCallback(sErr);
            else
                AppConfig.error(sErr);
        }
    };

    if (!sStat)
        returnError('Required property, sStat, not provided.');
    else if (!AppConfig.hStats[sStat])
        returnError('Stat not configured: '+sStat);
    else if (!AppConfig.hStats[sStat].fnValidate)
        returnError('fnValidate not defined for stat: '+sStat);
    else {
        async.waterfall([
            function(callback) {
                if (!oApp) {
                    Base.loadAppSingleton('app',callback);
                } else
                    callback(null,oApp);
            }
            ,function(oApp,callback) {
                AppConfig.hStats[sStat].fnValidate(Params, function (err, sKey) {
                    if (err)
                        returnError(err);
                    else {

                        // Create name key for redis for each granularity + app.sid. Config will determine which are processed and kept.
                        sStat = oApp.getKey()+'-'+sStat;
                        var aKeys = [
                                sStat + ','
                            , sStat + ',' + dDate.year()
                            , sStat + ',' + dDate.year() + ',' + dDate.month()
                            , sStat + ',' + dDate.year() + ',' + dDate.month() + ',' + dDate.date()
                            , sStat + ',' + dDate.year() + ',' + dDate.month() + ',' + dDate.date() + ',' + dDate.hour()
                        ];

                        if (aKeys.length) {
                            if (sKey)
                                AppConfig.Redis.hincrby(aKeys, sKey, hOpts.nFakeCount||1, callback, AppConfig.hStats.sDbAlias);
                            else {
                                AppConfig.Redis.incrby(aKeys, hOpts.nFakeCount||1, callback, AppConfig.hStats.sDbAlias);
                            }
                        }
                    }
                });
            }

        ],fnCallback);
    }
};
/**
 * This method walks through all the stats in the configuration file
 * and creates collections of stat data in redis.
 * @param fnCallback
 */
module.exports.process = function(hOpts,fnCallback) {
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = {};
    }
    var oApp = (hOpts && hOpts.oApp) ? hOpts.oApp : null;

    if (hOpts && hOpts.nMin)
        hOpts.dStart = new Date(hOpts.nMin);
    if (hOpts && hOpts.nMax)
        hOpts.dEnd = new Date(hOpts.nMax);

    AppConfig.info('Processing stats...');

    var aDbStats = [];
    var aRedisStats = [];
    var hConfirmExtras = {};
    async.series([
        function(callback) {
            if (!oApp) {
                Base.loadAppSingleton('app',function(err,oResult){
                    oApp = oResult;
                    callback();
                });
            } else
                callback();
        }
        // STEP ONE. The config tells us which kind of stat is which.  This method processes only redis stats.
        ,function(callback) {
            // If the user passes in an sStat property, just run the one stat.
            // If he passes in a hash called hStats, the keys in the hash should be stat names.
            var hStats =  {};
            if (hOpts.sStat && AppConfig.hStats[hOpts.sStat])
                hStats[hOpts.sStat] = AppConfig.hStats[hOpts.sStat];
            else if (hOpts.hStats)
                hStats = hOpts.hStats;
            else
                hStats = AppConfig.hStats;

            for (var sStat in hStats) {
                if (hStats[sStat].fnValidate) {
                    aRedisStats.push(sStat);
                    hConfirmExtras[sStat] = {nSize:1};
                } else if (hStats[sStat].fnProcessQuery) {// Mysql-based stats provide a query to retrieve the stat with a passed-in date range.
                    aDbStats.push(sStat);
                    hConfirmExtras[sStat] = {nSize:1};
                }
            }
            callback();
        }
        // STEP TWO:
        // Look up the stat in the singleton table by calling loadExtras on the oApp.
        // This will create it if it doesn't already exist.
        ,function(callback) {
            oApp.loadExtras(hConfirmExtras,callback);
        }
        // STEP THREE. Process redis-based stats. We could process db-based stats in parallel, but for readability this is done in series.
        ,function(callback) {
            if (!aRedisStats || !aRedisStats.length)
                callback();
            else
                async.forEachLimit(aRedisStats,1,function(sStat,cb) {
                    AppConfig.info('Processing redis stat: '+sStat+'; App: '+oApp.getKey());
                    async.waterfall([
                        // Step 1. We need to pull the key from Redis. This is not a fast query and so should be run at off hours
                        // or on a separate server altogether - and you could even query a backup Redis instance so as not to tax the
                        // primary redis box.
                        function(cback) {
                            AppConfig.Redis.keys(oApp.getKey()+'-'+sStat+',*',cback,AppConfig.hStats.sDbAlias);
                        }
                        // Step 2, loop through keys that are at or above the desired granularity.
                        ,function(aKeys,cback) {
                            if (!aKeys || !aKeys.length)
                                cback(null,null);
                            else
                                async.forEach(aKeys,function(sKey,cback2){
                                    // If the stat isn't a simple counter, look up the number of name-value pairs using the Redis HLEN command.
                                    // Otherwise, just use GET.
                                    async.waterfall([
                                        function(cback3){
                                            // Call the validate function without params. if it doesn't error out and returns empty key it's a simple count.
                                            AppConfig.hStats[sStat].fnValidate(null,function(err){
                                                if (err) {
                                                    AppConfig.Redis.hgetall(sKey,cback3,AppConfig.hStats.sDbAlias);
                                                } else
                                                    AppConfig.Redis.get(sKey,cback3,AppConfig.hStats.sDbAlias);
                                            });
                                        }
                                    ],function(err,res){
                                        if (err || !res)
                                            cback2(err);
                                        else {
                                            var aParts = sKey.split(',');

                                            var dDate = (aParts[1]) ? moment({year:aParts[1],month:aParts[2],day:aParts[3],hour:aParts[4]}) : null;
                                            var sGrain = (aParts[2]==undefined) ? 'year' : (aParts[3]==undefined) ? 'month' : (aParts[4]==undefined) ? 'day' : 'hour';

                                            // Each stat ends up as a record in the StatTbl. This method is used for both redis stats and db stats to store the processed output.
                                            var processRedisStat = function(hOpts,callback) {

                                                var hQuery = {name:hOpts.name,year:hOpts.year,month:hOpts.month,day:hOpts.day,hour:hOpts.hour};
                                                if (oApp.getKey()) hQuery.app_id = oApp.getKey();

                                                Base.lookup({sClass:'Stat',hQuery:hQuery},function(err,oStat){
                                                    if (err)
                                                        callback(err);
                                                    else {
                                                        var nOldCount = (validator.isInt(oStat.get('count'))) ? validator.toInt(oStat.get('count')) : 0;
                                                        var nAdd = (validator.isInt(hOpts.count)) ? validator.toInt(hOpts.count) : (hOpts.count instanceof Array) ? hOpts.count.length : 0;

                                                        oStat.setData({
                                                            count:hOpts.count
                                                            ,name:hOpts.name
                                                            ,year:hOpts.year||null
                                                            ,month:hOpts.month||null
                                                            ,day:hOpts.day||null
                                                            ,hour:hOpts.hour||null
                                                            ,date:hOpts.date||moment().utc().valueOf()
                                                            ,app_id:oApp.getKey()
                                                        });
                                                        oStat.set('count',nOldCount+nAdd);

                                                        // Loop through the items in the 'filters' property that has been passed in and update the stat object.

                                                        if (hOpts.filters) {
                                                            for (var sKey in hOpts.filters) {
                                                                if (oStat.getHashKey('filters',sKey))
                                                                    oStat.setHashKey('filters',sKey,(Number(oStat.getHashKey('filters',sKey)) + Number(hOpts.filters[sKey])));
                                                                else
                                                                    oStat.setHashKey('filters',sKey,Number(hOpts.filters[sKey]));
                                                            }
                                                        }

                                                        async.series([
                                                            // Save the stat.
                                                            function(cb) {
                                                                oStat.save({bForce:true},cb);
                                                            }
                                                            // Make sure the stat is available on the app singleton.
                                                            ,function(cb) {
                                                                if (!oApp[hOpts.name]) {
                                                                    var hExtras = {};
                                                                    hExtras[hOpts.name] = {hExtras:{}};
                                                                    hExtras[hOpts.name].hExtras[hOpts.sGrain] = true;
                                                                    oApp.loadExtras(hExtras,cb);
                                                                } else
                                                                    cb();
                                                            }
                                                            // Call setExtra on the stat, as that will save the record and add it to the collection of related stats.
                                                            ,function(cb) {
                                                                if (oApp[hOpts.name] && hOpts.sGrain)
                                                                    oApp[hOpts.name].setExtra(hOpts.sGrain,oStat,cb);
                                                                else
                                                                    cb();
                                                            }
                                                            // Once we've counted the stat, flush the value from Redis - saves space and confirms that it's been counted.
                                                            ,function(cb){
                                                                AppConfig.Redis.del(hOpts.sKey,cb,oStat.getSettings().sDbAlias);
                                                            }
                                                        ],callback);
                                                    }
                                                });
                                            };

                                            if (res instanceof Object) {
                                                // One pass for aggregate count.
                                                var nCount = 0;
                                                var filters = {};
                                                for (var sFilter in res) {
                                                    if (AppConfig.hStats[sStat].bFilters)
                                                        nCount += Number(res[sFilter]);
                                                    else
                                                        nCount++;
                                                }

                                                processRedisStat({
                                                    sKey:sKey
                                                    ,sGrain:sGrain
                                                    ,count:nCount
                                                    ,filters:(AppConfig.hStats[sStat].bFilters) ? res : null
                                                    ,name:sStat
                                                    ,year:aParts[1]||null
                                                    ,month:aParts[2]||null
                                                    ,day:aParts[3]||null
                                                    ,hour:aParts[4]||null
                                                    ,date:(dDate) ? dDate.utc().valueOf() : null
                                                },cback2);

                                            } else
                                                processRedisStat({
                                                    sKey:sKey
                                                    ,sGrain:sGrain
                                                    ,count:res
                                                    ,name:sStat
                                                    ,year:aParts[1]||null
                                                    ,month:aParts[2]||null
                                                    ,day:aParts[3]||null
                                                    ,hour:aParts[4]||null
                                                    ,date:(dDate) ? dDate.utc().valueOf() : null
                                                },cback2);

                                        }
                                    });
                                },function(err){
                                    cback(err,null);
                                });
                        }
                        ,function(n,cback) {
                            oApp[sStat].set('updated',new Date().getTime());
                            oApp[sStat].save(cback);
                        }
                    ],cb);

                },callback);
        }
        // STEP FOUR. Process mysql-based stats.
        ,function(callback) {
            if (aDbStats.length)
                async.forEachLimit(aDbStats,1,function(sStat,cb){
                    AppConfig.info('Processing mysql stat: '+sStat+'; App: '+oApp.getKey());

                    var hSettings = AppConfig.hStats[sStat];
                    var processMySqlStat = function(hOpts,cb2) {

                        AppConfig.debug('=====####################==========');
                        AppConfig.debug(hOpts);

                        async.parallel([
                            // Look up the related stat in the stats table.
                            function(cb3) {
                                var hQuery = {name:sStat,year:hOpts.year,month:hOpts.month,day:hOpts.day,hour:hOpts.hour};
                                if (oApp.getKey()) hQuery.app_id = oApp.getKey();
                                Base.lookup({sClass:'Stat',hQuery:hQuery},cb3);
                            }
                            // Look the stat up directly from the model data, using the fnProcessQuery from the stat configuration.
                            ,function(cb3) {
                                // We're looking only in the timespan specified in processMySqlStat(hOpts), if any.
                                // Otherwise look in the parent hOpts;
                                var hSubOpts = {oApp:oApp}; // The oApp can help you filter by tenant, if you are serving multiple tenants with your stats.
                                if (hOpts.year) {
                                    var dStart = moment({year:hOpts.year,month:hOpts.month,day:hOpts.day,hour:hOpts.hour}).utc();
                                    var dEnd;

                                    if (hOpts.hour)
                                        dEnd = moment(dStart).add('hours',1);
                                    else if (hOpts.day)
                                        dEnd = moment(dStart).add('days',1);
                                    else if (hOpts.month) {
                                        dEnd = moment(dStart).add('months',1);
                                    } else if (hOpts.year)
                                        dEnd = moment(dStart).add('years',1);

                                    AppConfig.info('---- '+dStart.toString()+' -> '+dEnd.toString());
                                    hSubOpts.nMin = dStart.valueOf();
                                    hSubOpts.nMax = dEnd.valueOf();
                                }
                                new Collection({sClass:hSettings.sClass,sSource:'MySql',nSize:1,hQuery:hSettings.fnProcessQuery(hSubOpts,AppConfig)},cb3);
                            }
                        ],function(err,aResults){
                            if (err)
                                cb2(err);
                            else {
                                var oStat = aResults[0];
                                var cColl = aResults[1];

                                // Update the oStat.count with the cColl.nTotal. This is an overwrite because the total stat is being pulled, not just an increment.
                                oStat.setData({
                                    count:cColl.nTotal
                                    ,name:sStat
                                    ,hour:hOpts.hour
                                    ,day:hOpts.day
                                    ,month:hOpts.month
                                    ,year:hOpts.year
                                    ,app_id:oApp.getKey()
                                });

                                if (cColl.nTotal)
                                    AppConfig.info(oStat.hData);

                                if (hOpts.year)
                                    oStat.set('date',moment(hOpts).utc().valueOf())

                                oStat.save({bDebug:true},cb2);
                            }
                        });
                    };

                    var updateSingletonAndFinish = function(err) {
                        if (err)
                            cb(err);
                        else {
                            oApp[sStat].set('updated',new Date().getTime());
                            oApp[sStat].save(cb);
                        }
                    };

                    // If a date range is passed in via hOpts, then we'll process day, hour, month, etc. Otherwise, we'll do only 'all' time stat.
                    if (hOpts && hOpts.dStart && hOpts.dEnd) {
                        // process each hour between dStart and dEnd;

                        var dNow = moment(hOpts.dStart).utc();
                        var dEnd = moment(hOpts.dEnd).utc();
                        // And do one for the 'all' count:
                        var aIncrements = [{year:null,month:null,hour:null,day:null}];
                        // And add one for each unique day, month and year;
                        var nDay;
                        var nMonth;
                        var nYear;
                        // This creates an array of time grains for which to process db stats.
                        // The default is hourly, but you can pass in an 'sGrain' value in hOpts that
                        // can be day (days), month (months) or year (years).
                        var sGrain = (hOpts && hOpts.sGrain && hOpts.sGrain.match(/^(hour(s)?|day(s)?|month(s)?|year(s)?)/)) ? hOpts.sGrain : 'hours';
                        if (!sGrain.match(/s$/)) sGrain += 's';

                        AppConfig.info('Processing granularity: '+sGrain);
                        while (dNow < dEnd) {
                            if (nDay != dNow.date()) {
                                nDay = dNow.date();
                                aIncrements.push({year: dNow.year(), month: dNow.month(), day: dNow.date(), hour: null});
                            } else if (nMonth != dNow.month()) {
                                nMonth = dNow.month();
                                aIncrements.push({year: dNow.year(), month: dNow.month(), day: null, hour: null});
                            } else if (nYear != dNow.year()){
                                nYear = dNow.year();
                                aIncrements.push({year: dNow.year(), month: null, day: null, hour: null});
                            } else
                                aIncrements.push({year:dNow.year(),month:dNow.month(),hour:dNow.hour(),day:dNow.date()});

                            dNow.add(sGrain,1);
                        }
                        async.forEachLimit(aIncrements,1,processMySqlStat,updateSingletonAndFinish);

                    } else
                        processMySqlStat({year:null,day:null,month:null,hour:null},updateSingletonAndFinish);

                },callback);
            else
                callback();
        }
    ],fnCallback);
};
/**
 * This method is used by unit tests to remove any and all stat/analytic data before and after a test run. Don't use
 * this at all, or use it with great care!
 *
 * @param fnCallback
 */
module.exports.flush = function(hOpts,fnCallback){
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts= {};
    }

    // Create a collection of 'App' objects for which to remove stats. If the oApp option is passed in
    // then that's all we touch. Otherwise we get 'em all.
    var cApps = new Collection({sClass:'App'});
    var hExtras = {};// Will house all the stats we want to gather.
    var aExtras = []; // Will need the extras in an array for easier async.forEach.

    async.series([
        // Create collection of apps to flush stats for.
        function(callback) {
            if (hOpts && hOpts.oApp) {
                cApps.add(hOpts.oApp);
                callback();
            } else
                Collection.lookup({sClass:'App',hQuery:{app_id:'IS NULL'}},function(err,cColl){
                    if (err)
                        callback(err);
                    else {
                        cApps = cColl;
                        callback();
                    }
                });
        }
        // Next, get all the stats from the _SingletonTbl, which we'll do via the App class.
        ,function(callback) {
            if (cApps.nTotal)
                Collection.lookup({sClass:'App',hQuery:{app_id:'IS NOT NULL'}},function(err,cColl){
                    if (cColl.nTotal) {
                        while (cColl.next()) {
                            hExtras[cColl.getItem().get('sid')] = {hExtras:{hour:true,day:true,month:true,year:true,alltime:true}};
                            aExtras.push(cColl.getItem().get('sid'));
                        }
                    }
                    callback(err);
                });
            else
                callback('No apps found.');
        }
        // For each app found, load extras and then delete.
        ,function(callback) {
            async.forEach(cApps.aObjects,function(hItem,cb){

                var oApp = Base.lookup({sClass:'App',hData:hItem});
                async.series([
                    function(cb2) {
                        oApp.loadExtras(hExtras,cb2);
                    }
                    ,function(cb2) {
                        async.forEach(aExtras,function(sExtra,cb3){
                            if (oApp[sExtra]) {
                                var aGrains = AppConfig.hStats[sExtra].aGrains || ['hour', 'day', 'month', 'year', 'alltime'];
                                async.forEach(aGrains,function(sGrain,cb4){
                                    if (oApp[sExtra] && oApp[sExtra][sGrain] && oApp[sExtra][sGrain].nTotal) {
                                        AppConfig.info('DELETE '+sExtra+'.'+sGrain+': '+oApp[sExtra][sGrain].nTotal);
                                        oApp[sExtra][sGrain].delete(cb4);
                                    } else
                                        cb4();
                                },cb3);
                            } else
                                cb3();
                        },cb2);
                    }

                ],cb);

            },callback);
        }
    ],fnCallback);
};