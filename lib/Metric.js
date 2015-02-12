var util        = require('util'),
    async       = require('async'),
    moment      = require('moment'),
    Base        = require('./Base'),
    Config      = require('./AppConfig'),
    Collection  = require('./Collection');

function Metric(hOpts,fnCallback) {
    this.sClass = 'Metric';
    Metric.super_.call(this,hOpts,fnCallback);
}
util.inherits(Metric,Base);
var p = Metric.prototype;

module.exports = Metric;
/**
 * Retrieve a Metric for the passed-in, named Metric. Metrics are defined in an 'hMetrics' block either within
 * a Class definition in the configuration file, or at the root level of the configuration (those Metrics not associated with specific classes).
 *
 * @param hOpts
 * @param fnCallback
 */
module.exports.lookup = function(hOpts,fnCallback) {
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = {};
    }
    if (!hOpts.sClass && hOpts.nClass)
        hOpts.sClass = Config.getClassMap(hOpts.nClass);

    if (!hOpts.hMetrics) {
        Base.lookup({sClass:'Metric',hQuery:hOpts.hQuery,hData:hOpts.hData},fnCallback);
    } else {
        if (hOpts.sClass && (!Config.hClasses[hOpts.sClass] || !Config.hClasses[hOpts.sClass].hMetrics))
            fnCallback('No hMetrics configuration found for class: '+hOpts.sClass+'.');
        else if (!hOpts.sClass && (!Config.hMetrics || !Config.hMetrics[hOpts.sName]))
            fnCallback('Missing configuration for Metric: '+hOpts.sName+' in root hMetrics definition.');
        else {
            var oResult = new Base({sClass:'Metric'});

            var sErr = '';
            async.forEach(Object.keys(hOpts.hMetrics),function(sName,cb) {

                if (!Config.hClasses[hOpts.sClass].hMetrics[sName]) {
                    sErr += 'Missing configuration for Metric: ' + hOpts.sName + ' in class ' + hOpts.sClass;
                    cb();
                } else {

                    var sMetric = (hOpts.sClass) ? hOpts.sClass+'.'+sName : sName;
                    var sOrderBy = (hOpts.sOrderBy) ? hOpts.sOrderBy : 'date';
                    var bReverse = (hOpts.bReverse) ? hOpts.bReverse : false;

                    async.forEach(Object.keys(hOpts.hMetrics[sName]),function(sGrain,cb2){

                        if (hOpts.hMetrics[sName][sGrain] && (!Config.hClasses[hOpts.sClass].hMetrics[sName].hGrains[sGrain])) {

                            Config.warn('Metric ('+hOpts.sClass+'.'+sName+') does not support grain ('+sGrain+').')
                            cb2();

                        } else if (hOpts.hMetrics[sName][sGrain]) {

                            var sStatement = (hOpts.sFilter) ? 'sFilter = ? AND sName=?' : 'sName=?';
                            var aValues = (hOpts.sFilter) ?  [hOpts.sFilter,sMetric] : [sMetric];
                            if (hOpts.nMin && hOpts.nMax && sGrain != 'alltime') {
                                sStatement += ' AND date >= ? AND date <= ?';
                                aValues = aValues.concat([hOpts.nMin,hOpts.nMax]);
                            }

                            switch (sGrain) {
                                case 'alltime':
                                    sStatement += ' AND year IS NULL';
                                    break;
                                case 'year':
                                    sStatement += ' AND year IS NOT NULL AND month IS NULL';
                                    break;
                                case 'month':
                                    sStatement += ' AND year IS NOT NULL AND month IS NOT NULL AND day IS NULL';
                                    break;
                                case 'day':
                                    sStatement += ' AND year IS NOT NULL AND month IS NOT NULL AND day IS NOT NULL AND hour IS NULL';
                                    break;
                                case 'hour':
                                    sStatement += ' AND year IS NOT NULL AND month IS NOT NULL AND day IS NOT NULL AND hour IS NOT NULL';
                                    break;
                            }

                            Collection.lookup({sClass:'Metric',hQuery:{aStatements:[sStatement],aValues:aValues},sOrderBy:sOrderBy,bReverse:bReverse},function(err,cColl){
                                if (!oResult[sName]) oResult[sName] = {};
                                if (cColl) {
                                    if (sGrain == 'alltime') {
                                        oResult[sName][sGrain] = cColl.first();
                                    } else
                                        oResult[sName][sGrain] = cColl;
                                }
                                cb2(err);
                            });

                        } else
                            cb2();

                    },cb)
                }

            },function(err){
                fnCallback(sErr,oResult);
            });
        }
    }
};
/**
 * Promise-based version of lookup.
 * @param hOpts
 * @returns {promise}
 */
module.exports.lookupP = function(hOpts) {
    return new promise(function (resolve, reject) {
        Metric.lookup(hOpts,function(err,oObj){
            if (err)
                reject(err);
            else
                resolve(oObj);
        });
    });
};
/**
 * Used to increment a metric in redis.
 *
 * @param hOpts
 * @param fnCallback
 */
module.exports.track = function(hOpts,fnCallback) {

};
/**
 * Process all metrics defined in the configuration file, for the time-period passed in via hOpts.
 *
 * @param hOpts
 *  nMin - timestamp of the starting point of the period to be processed.
 *  nMax - timestamp of the endpoint point of the period to be processed.
 *  sFilter - filter value to limit the process to a particular tenant in a multi-tenant environment (optional). User is responsible for
 *  handling the filter in the fnQuery definition in the configuration file.
 *
 * @param fnCallback (optional)
 */
module.exports.process = function(hOpts,fnCallback) {
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = {};
    }
    hOpts.dStart = (hOpts.dStart) ? hOpts.dStart : (hOpts.nMin) ? moment.utc(hOpts.nMin) : null;
    hOpts.dEnd = (hOpts.dEnd) ? hOpts.dEnd : (hOpts.nMax) ? moment.utc(hOpts.nMax) : null;

    var aDbMetrics = [];
    var aRedisMetrics = [];

    async.series([
        // STEP ONE. The config tells us which kind of stat is which.  This method processes only redis stats.
        function(callback) {
            // If the user passes in an sMetric & sClass property, just run the one stat.
            // Otherwise, run 'em all. Put MySql-based stats in their own bucket, and Redis into theirs.
            var pushStat = function(sName,sClass,hSettings) {
                if (hSettings.fnValidate) {
                    aRedisMetrics.push({sName:sName,sClass:sClass,hSettings:hSettings});
                } else if (hSettings.fnQuery) {// Mysql-based stats provide a query to retrieve the stat with a passed-in date range.
                    aDbMetrics.push({sName:sName,sClass:sClass,hSettings:hSettings});
                }
            };

            for (var sClass in Config.hClasses) {
                if (Config.hClasses[sClass].hMetrics) {
                    for (var sMetric in Config.hClasses[sClass].hMetrics) {
                        if (!hOpts.sName)
                            pushStat(sMetric,sClass,Config.hClasses[sClass].hMetrics[sMetric]);
                        else if (hOpts.sName == sMetric && hOpts.sClass == sClass)
                            pushStat(sMetric,sClass,Config.hClasses[sClass].hMetrics[sMetric]);
                    }
                }
            }

            callback();
        }
        // STEP THREE. Process mysql-based stats.
        ,function(callback) {
            if (aDbMetrics.length)
                async.forEachLimit(aDbMetrics,1,function(hItem,cb){
                    var hSettings = hItem.hSettings;

                    var processMySqlStat = function(hIncrement,cb2) {
                        var dStart = (hIncrement.year) ? moment.utc(hIncrement) : '';
                        var sStart = (dStart) ? dStart.toString() : '';
                        //console.log(hItem.sClass+'.'+hItem.sName+': '+hIncrement.sGrain+' - '+sStart);

                        async.parallel([
                            // Look up the related stat in the stats table.
                            function(cb3) {
                                var hQuery = {year:hIncrement.year,month:hIncrement.month,day:hIncrement.day,hour:hIncrement.hour};
                                hQuery.sName = (hItem.sClass) ? hItem.sClass+'.'+hItem.sName : hItem.sName
                                if (hOpts.sFilter) hQuery.sFilter = hOpts.sFilter;
                                Base.lookup({sClass:'Metric',hQuery:hQuery},cb3);
                            }
                            // Look the stat up directly from the model data, using the fnQuery from the stat configuration.
                            ,function(cb3) {
                                // We're looking only in the timespan specified in processMySqlStat(hIncrement), if any.
                                // Otherwise look in the parent hOpts;
                                //var oStat =
                                var hSubOpts = {}; // The sFilter can help you filter by tenant, if you are serving multiple tenants with your stats.
                                if (hOpts.sFilter) hSubOpts.sFilter = hOpts.sFilter;
                                hSubOpts.sName = (hItem.sClass) ? hItem.sClass+'.'+hItem.sName : hItem.sName;
                                if (hIncrement.year) {
                                    var dEnd = dStart.clone().add(1,hIncrement.sGrain);
                                    hSubOpts.nMin = dStart.valueOf();
                                    hSubOpts.nMax = dEnd.valueOf();
                                }
                                hSettings.fnQuery(hSubOpts,Config,function(err,hQuery){
                                    if (err)
                                        cb3(err);
                                    else
                                        Collection.lookup({sClass:hItem.sClass,sSource:'MySql',nSize:1,hQuery:hQuery},cb3);
                                });

                            }
                        ],function(err,aResults){
                            if (err)
                                cb2(err);
                            else {
                                var oStat = aResults[0];
                                var cColl = aResults[1];

                                // Update the oStat.count with the cColl.nTotal. This is an overwrite because the total stat is being pulled, not just an increment.
                                var name = (hItem.sClass) ? hItem.sClass+'.'+hItem.sName : hItem.sName;
                                oStat.setData({
                                    nCount:cColl.nTotal||0
                                    ,sFilter:hOpts.sFilter
                                    ,sName:name
                                    ,hour:hIncrement.hour
                                    ,day:hIncrement.day
                                    ,month:hIncrement.month
                                    ,year:hIncrement.year
                                });
                                if (hIncrement.year)
                                    oStat.set('date',moment.utc(hIncrement).valueOf());

                                oStat.save(cb2);
                            }
                        });
                    };

                    // If a date range is passed in via hOpts, then we'll process day, hour, month, etc. Otherwise, we'll do only 'all' time stat.
                    if (hOpts && hOpts.dStart && hOpts.dEnd) {
                        if (!hSettings.hGrains)
                            cb('Metric does not have granularity configured. Must have an \'hGrains\' hash that can include boolean values for alltime,year,month,day and/or hour.');
                        else {
                            var aIncrements = [];
                            if (hSettings.hGrains.alltime)
                                aIncrements.push({year:null,month:null,hour:null,day:null,sGrain:'alltime'});

                            // Use the lowest granularity to iterate through the time span.
                            var sGrain = (hOpts.sGrain) ? hOpts.sGrain : (hSettings.hGrains.hour) ? 'hour' : (hSettings.hGrains.day) ? 'day' : (hSettings.hGrains.month) ? 'month' : 'year';
                            var dNow = hOpts.dStart.clone().startOf(sGrain);
                            var dEnd = hOpts.dEnd.clone().startOf(sGrain);

                            // Do not process beyond now.
                            if (dEnd.valueOf() > moment.utc().valueOf())
                                dEnd = moment.utc();

                            var nDay;
                            var nMonth;
                            var nYear;
                            var nHour;

                            while (dNow <= dEnd) {
                                if (nHour != dNow.hour() && hSettings.hGrains.hour && (!hOpts.sGrain || hOpts.sGrain=='hour')) {
                                    nHour = dNow.hour();
                                    aIncrements.push({year: dNow.year(), month: dNow.month(), day: dNow.date(), hour:dNow.hour(), sGrain:sGrain});
                                }
                                if (nDay != dNow.date() && hSettings.hGrains.day && (!hOpts.sGrain || hOpts.sGrain=='day')) {
                                    nDay = dNow.date();
                                    aIncrements.push({year: dNow.year(), month: dNow.month(), day: dNow.date(), hour: null,sGrain:sGrain});
                                }
                                if (nMonth != dNow.month() && hSettings.hGrains.month && (!hOpts.sGrain || hOpts.sGrain=='month')) {
                                    nMonth = dNow.month();
                                    aIncrements.push({year: dNow.year(), month: dNow.month(), day: null, hour: null,sGrain:sGrain});
                                }
                                if (nYear != dNow.year() && hSettings.hGrains.year && (!hOpts.sGrain || hOpts.sGrain=='year')){
                                    nYear = dNow.year();
                                    aIncrements.push({year: dNow.year(), month: null, day: null, hour: null,sGrain:sGrain});
                                }
                                dNow.add(1,sGrain);
                            }
                            async.forEachLimit(aIncrements,1,processMySqlStat,cb);
                        }

                    } else
                        processMySqlStat({year:null,day:null,month:null,hour:null,sGrain:'alltime'},cb);

                },callback);
            else
                callback();
        }
        // STEP FOUR. Redis-based stats.
        //,function(callback) {
        //    if (!aRedisMetrics || !aRedisMetrics.length)
        //        callback();
        //    else
        //        async.forEachLimit(cApps.aObjects,1,function(hApp,cback){
        //
        //            async.forEachLimit(aRedisMetrics,1,function(sMetric,cb) {
        //                Config.info('Processing redis stat: '+sMetric+'; App: '+oApp.getKey());
        //                async.waterfall([
        //                    // Step 1. We need to pull the key from Redis. This is not a fast query and so should be run at off hours
        //                    // or on a separate server altogether - and you could even query a backup Redis instance so as not to tax the
        //                    // primary redis box.
        //                    function(cback) {
        //                        Config.Redis.keys(oApp.getKey()+'-'+sMetric+',*',cback,Config.hMetrics.sDbAlias);
        //                    }
        //                    // Step 2, loop through keys that are at or above the desired granularity.
        //                    ,function(aKeys,cback) {
        //                        if (!aKeys || !aKeys.length)
        //                            cback(null,null);
        //                        else
        //                            async.forEach(aKeys,function(sKey,cback2){
        //                                // If the stat isn't a simple counter, look up the number of name-value pairs using the Redis HLEN command.
        //                                // Otherwise, just use GET.
        //                                async.waterfall([
        //                                    function(cback3){
        //                                        // Call the validate function without params. if it doesn't error out and returns empty key it's a simple count.
        //                                        Config.hMetrics[sMetric].fnValidate(null,function(err){
        //                                            if (err)
        //                                                Config.Redis.hgetall(sKey,cback3,Config.hMetrics.sDbAlias);
        //                                            else
        //                                                Config.Redis.get(sKey,cback3,Config.hMetrics.sDbAlias);
        //                                        });
        //                                    }
        //                                ],function(err,res){
        //                                    if (err || !res)
        //                                        cback2(err);
        //                                    else {
        //                                        var aParts = sKey.split(',');
        //
        //                                        var dDate = (aParts[1]) ? moment.utc({year:aParts[1],month:aParts[2],day:aParts[3],hour:aParts[4]}) : null;
        //                                        var sGrain = (aParts[2]==undefined) ? 'year' : (aParts[3]==undefined) ? 'month' : (aParts[4]==undefined) ? 'day' : 'hour';
        //
        //                                        // Each stat ends up as a record in the StatTbl. This method is used for both redis stats and db stats to store the processed output.
        //                                        var processRedisMetric = function(hOpts,callback) {
        //
        //                                            // Make sure we care about this grain on this stat.
        //                                            if (Config.hMetrics[hOpts.name] && Config.hMetrics[hOpts.name].aGrains && !Config.hMetrics[hOpts.name].aGrains.join(',').match(hOpts.sGrain)) {
        //                                                cback2();
        //                                            } else {
        //                                                var hQuery = {name:hOpts.name,year:hOpts.year,month:hOpts.month,day:hOpts.day,hour:hOpts.hour,sFilter:oApp.getKey()};
        //
        //                                                Base.lookup({sClass:'Stat',hQuery:hQuery,sSource:'MySql'},function(err,oStat){
        //                                                    if (err)
        //                                                        callback(err);
        //                                                    else {
        //                                                        var nOldCount = (validator.isInt(oStat.get('count'))) ? validator.toInt(oStat.get('count')) : 0;
        //                                                        var nAdd = (validator.isInt(hOpts.count)) ? validator.toInt(hOpts.count) : (hOpts.count instanceof Array) ? hOpts.count.length : 0;
        //
        //                                                        oStat.setData({
        //                                                            count:hOpts.count||0
        //                                                            ,name:hOpts.name
        //                                                            ,year:hOpts.year||null
        //                                                            ,month:hOpts.month||null
        //                                                            ,day:hOpts.day||null
        //                                                            ,hour:hOpts.hour||null
        //                                                            ,date:hOpts.date||moment.utc().valueOf()
        //                                                            ,sFilter:oApp.getKey()
        //                                                        });
        //                                                        oStat.set('count',nOldCount+nAdd);
        //
        //                                                        // Loop through the items in the 'filters' property that has been passed in and update the stat object.
        //
        //                                                        if (hOpts.filters) {
        //                                                            for (var sKey in hOpts.filters) {
        //                                                                if (oStat.getHashKey('filters',sKey))
        //                                                                    oStat.setHashKey('filters',sKey,(Number(oStat.getHashKey('filters',sKey)) + Number(hOpts.filters[sKey])));
        //                                                                else
        //                                                                    oStat.setHashKey('filters',sKey,Number(hOpts.filters[sKey]));
        //                                                            }
        //                                                        }
        //
        //                                                        async.series([
        //                                                            // Save the stat.
        //                                                            function(cb) {
        //                                                                oStat.save({bForce:true},cb);
        //                                                            }
        //                                                            // Make sure the stat is available on the app singleton.
        //                                                            ,function(cb) {
        //                                                                if (!oApp[hOpts.name]) {
        //                                                                    var hExtras = {};
        //                                                                    hExtras[hOpts.name] = {hExtras:{}};
        //                                                                    hExtras[hOpts.name].hExtras[hOpts.sGrain] = true;
        //                                                                    oApp.loadExtras(hExtras,cb);
        //                                                                } else
        //                                                                    cb();
        //                                                            }
        //                                                            // Call setExtra on the stat, as that will save the record and add it to the collection of related stats.
        //                                                            ,function(cb) {
        //                                                                if (oApp[hOpts.name] && hOpts.sGrain)
        //                                                                    oApp[hOpts.name].setExtra(hOpts.sGrain,oStat,cb);
        //                                                                else
        //                                                                    cb();
        //                                                            }
        //                                                            // Once we've counted the stat, flush the value from Redis - saves space and confirms that it's been counted.
        //                                                            ,function(cb){
        //                                                                Config.Redis.del(hOpts.sKey,cb,oStat.getSettings().sDbAlias);
        //                                                            }
        //                                                        ],callback);
        //                                                    }
        //                                                });
        //                                            }
        //                                        };
        //
        //                                        if (res instanceof Object) {
        //                                            // One pass for aggregate count.
        //                                            var nCount = 0;
        //                                            var filters = {};
        //                                            for (var sFilter in res) {
        //                                                if (Config.hMetrics[sMetric].bFilters)
        //                                                    nCount += Number(res[sFilter]);
        //                                                else
        //                                                    nCount++;
        //                                            }
        //
        //                                            processRedisMetric({
        //                                                sKey:sKey
        //                                                ,sGrain:sGrain
        //                                                ,count:nCount
        //                                                ,filters:(Config.hMetrics[sMetric].bFilters) ? res : null
        //                                                ,name:sMetric
        //                                                ,year:aParts[1]||null
        //                                                ,month:aParts[2]||null
        //                                                ,day:aParts[3]||null
        //                                                ,hour:aParts[4]||null
        //                                                ,date:(dDate) ? dDate.utc().valueOf() : null
        //                                            },cback2);
        //
        //                                        } else
        //                                            processRedisMetric({
        //                                                sKey:sKey
        //                                                ,sGrain:sGrain
        //                                                ,count:res
        //                                                ,name:sMetric
        //                                                ,year:aParts[1]||null
        //                                                ,month:aParts[2]||null
        //                                                ,day:aParts[3]||null
        //                                                ,hour:aParts[4]||null
        //                                                ,date:(dDate) ? dDate.utc().valueOf() : null
        //                                            },cback2);
        //
        //                                    }
        //                                });
        //                            },function(err){
        //                                cback(err,null);
        //                            });
        //                    }
        //                    ,function(n,cback) {
        //                        oApp[sMetric].set('updated',new Date().getTime());
        //                        oApp[sMetric].save(cback);
        //                    }
        //                ],cb);
        //
        //            },cback);
        //        },callback);
        //}
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
    async.series([
        // DELETE ALL STATS FROM StatTbl in MySql
        function(callback) {
            var sDbAlias = (hOpts && hOpts.sDbAlias) ? hOpts.sDbAlias : (Config.hMetrics && Config.hMetrics.sDbAlias) ? Config.hMetrics.sDbAlias : 'default';
            Config.MySql.execute('DELETE FROM MetricTbl',null,callback,sDbAlias);
        }
        // TODO DELETE ALLS METRICS FROM Redis
        //,function(callback) {
        //
        //}
    ],fnCallback);
};