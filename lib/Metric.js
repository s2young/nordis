var util        = require('util'),
    async       = require('async'),
    moment      = require('moment'),
    Redis       = require('./Utils/Data/Redis'),
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
        Base.lookup({sClass:'Metric',sSource:'MySql',hQuery:hOpts.hQuery,hData:hOpts.hData},fnCallback);
    } else {
        if (hOpts.sClass && (!Config.hClasses[hOpts.sClass] || !Config.hClasses[hOpts.sClass].hMetrics))
            fnCallback('No hMetrics configuration found for class: '+hOpts.sClass+'.');
        else if (!hOpts.sClass && (!Config.hMetrics || !Config.hMetrics[hOpts.sName]))
            fnCallback('Missing configuration for Metric: '+hOpts.sName+' in root hMetrics definition.');
        else {
            var oResult = new Base({sClass:'Metric'});
            var sErr = '';
            async.forEach(Object.keys(hOpts.hMetrics),function(sName,cb) {
                var hConf = (hOpts.sClass && Config.hClasses[hOpts.sClass].hMetrics[sName]) ? Config.hClasses[hOpts.sClass].hMetrics[sName] : Config.hMetrics[sName];

                if (!hConf) {
                    sErr += 'Missing configuration for Metric: ' + sName;
                    if (hOpts.sClass) sErr += ' in class ' + hOpts.sClass;
                    cb();
                } else {

                    var sMetric = (hOpts.sClass) ? hOpts.sClass+'.'+sName : sName;
                    var sOrderBy = (hOpts.sOrderBy) ? hOpts.sOrderBy : 'date';
                    var bReverse = (hOpts.bReverse) ? hOpts.bReverse : false;

                    async.forEach(Object.keys(hOpts.hMetrics[sName]),function(sGrain,cb2){

                        if (hOpts.hMetrics[sName][sGrain] && (!hConf.hGrains[sGrain])) {

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
 * Core method for tracking stats using Redis. This method will call Redis.hincrby method if the passed-in
 * params pass muster, as defined in the configuration file.
 * @param hOpts - Hash containing the following:
 *
 * {
 *  sClass:'' - (required) String name of the class where the stat is defined in config.
 *  sMetric:'' - (required) String name of the metric as defined in config.
 *  Filter:''||[] - (optional) String or Array filter that identifies client(s) in a multi-client environment.
 *  Params:? - (required) String or array of parameters used to uniquely identify the item to be tracked (such as the url, user, etc)
 *  oApp:{} - (optional) App object corresponding to the tenant. If not provided, will assign the stat to the default tenant (sid='app')
 *  dDate:{} - (optional) Date object to assign the stat to. Primarily used for back-dated, fake stats in unit testing.
 *  nFakeCount:1 - (optional) Number to count for the stat. Primarily used for fake stats in unit testing.
 *
 * @param fnCallback
 * @param dDate - (optional) date object, if you want to force a date assignment on the stat (unit test, retro-active stat building, etc). Default is now (UTC).
 */
module.exports.track = function(hOpts,fnCallback){
    var dDate = (hOpts && hOpts.dDate) ? moment.utc(hOpts.dDate) : moment.utc();
    var sClass = (hOpts && hOpts.sClass) ? hOpts.sClass : '';
    var sMetric = (hOpts && hOpts.sMetric) ? hOpts.sMetric : '';
    var Params = (hOpts && hOpts.Params) ? hOpts.Params : null;
    var aFilters = (hOpts && hOpts.sFilter) ? [hOpts.sFilter] : (hOpts && hOpts.aFilters && hOpts.aFilters.length) ? hOpts.aFilters : [''];
    var hConf = (sClass && Config.hClasses[sClass] && Config.hClasses[sClass].hMetrics && Config.hClasses[sClass].hMetrics[sMetric]) ? Config.hClasses[sClass].hMetrics[sMetric] : (!sClass && Config.hMetrics && Config.hMetrics[sMetric]) ? Config.hMetrics[sMetric] : null;

    var returnError = function(sErr) {
        if (sErr) {
            if (fnCallback)
                fnCallback(sErr);
            else
                Config.error(sErr);
        }
    };

    if (!sMetric)
        returnError('Required property, sMetric, not provided.');
    else if (!hConf)
        returnError('Metric not configured: '+sMetric+'. Class: '+sClass);
    else {
        // Determine the unique key(s) to be incremented.
        var aKeys = [];
        var sName = (sClass) ? sClass+'.'+sMetric : sMetric;

        aFilters.forEach(function(sFilter) {
            if (sFilter==undefined) sFilter = '';
            if (hConf.hGrains.alltime) aKeys.push('METRIC|'+sFilter+'|'+sName);
            if (hConf.hGrains.year) aKeys.push('METRIC|'+sFilter+'|'+sName + '|' + dDate.year());
            if (hConf.hGrains.month) aKeys.push('METRIC|'+sFilter+'|'+sName + '|' + dDate.year() + '|' + dDate.month());
            if (hConf.hGrains.day) aKeys.push('METRIC|'+sFilter+'|'+sName + '|' + dDate.year() + '|' + dDate.month() + '|' + dDate.date());
            if (hConf.hGrains.hour) aKeys.push('METRIC|'+sFilter+'|'+sName + '|' + dDate.year() + '|' + dDate.month() + '|' + dDate.date() + '|' + dDate.hour());
        });

        // If the stat has an fnFilter method, then it's a filtered metric.
        if (hConf.fnFilter)
            hConf.fnFilter(Params, function (err, sGroupingFilter) {
                if (err || !sGroupingFilter)
                    returnError(err||'No grouping filter provided for Metric: '+sMetric+', Class: '+sClass);
                else
                    Config.Redis.hincrby(aKeys, sGroupingFilter, hOpts.nFakeCount||1, fnCallback, hConf.sDbAlias);
            });
        else
            Config.Redis.incrby(aKeys, hOpts.nFakeCount||1, fnCallback, hConf.sDbAlias);

    }
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
    hOpts.dStart = (hOpts.dStart) ? hOpts.dStart : (hOpts.nMin) ? moment.utc(hOpts.nMin) : moment.utc();
    hOpts.dEnd = (hOpts.dEnd) ? hOpts.dEnd : (hOpts.nMax) ? moment.utc(hOpts.nMax) : moment.utc();

    Config.silly('PROCESS METRICS: '+hOpts.dStart.toString()+' -> '+hOpts.dEnd.toString());
    var aDbMetrics = [];
    var aRedisMetrics = [];

    // STEP ONE. The config tells us which kind of stat is which.  This method processes only redis stats.

    // If the user passes in an sMetric & sClass property, just run the one stat.
    // Otherwise, run 'em all. Put MySql-based stats in their own bucket, and Redis into theirs.
    var pushStat = function(sName,sClass,hSettings) {
        switch (hSettings.sSource) {
            case 'Redis':
                aRedisMetrics.push({sName:sName,sClass:sClass,hSettings:hSettings});
                break;
            case 'MySql':
                aDbMetrics.push({sName:sName,sClass:sClass,hSettings:hSettings});
                break;
        }
    };

    for (var sClass in Config.hClasses) {
        for (var sMetric in Config.hClasses[sClass].hMetrics) {
            if (!hOpts.sName)
                pushStat(sMetric,sClass,Config.hClasses[sClass].hMetrics[sMetric]);
            else if (hOpts.sName == sMetric && hOpts.sClass == sClass)
                pushStat(sMetric,sClass,Config.hClasses[sClass].hMetrics[sMetric]);
        }
    }
    for (var sMetric in Config.hMetrics) {
        pushStat(sMetric,null,Config.hMetrics[sMetric]);
    }
    // PROCESS STATS IN PARALLEL
    async.parallel([
        // MySQL-based stats.
        function(callback) {
            if (aDbMetrics.length)
                async.forEachLimit(aDbMetrics,2,function(hItem,cb){
                    var hSettings = hItem.hSettings;

                    var nM;
                    var processMySqlMetric = function(hIncrement,cb2) {

                        if (hIncrement.month != nM) {
                            nM = hIncrement.month;
                            Config.info(hItem.sName+' ('+(hOpts.sFilter||'')+'): '+hIncrement.year+'/'+hIncrement.month);
                        }

                        var dStart = (hIncrement.year) ? moment.utc(hIncrement) : '';
                        var hQuery = {year:hIncrement.year,month:hIncrement.month,day:hIncrement.day,hour:hIncrement.hour};
                        hQuery.sName = (hItem.sClass) ? hItem.sClass+'.'+hItem.sName : hItem.sName

                        async.parallel([
                            // Look up the related stat in the stats table.
                            function(cb3) {
                                if (hOpts.sFilter) hQuery.sFilter = hOpts.sFilter;
                                Base.lookup({sClass:'Metric',sSource:'MySql',hQuery:hQuery},cb3);
                            }
                            // Look the stat up directly from the model data, using the fnQuery from the stat configuration.
                            ,function(cb3) {
                                // We're looking only in the timespan specified in processMySqlMetric(hIncrement), if any.
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

                                if (cColl.nTotal) {
                                    // Update the oStat.count with the cColl.nTotal. This is an overwrite because the total stat is being pulled, not just an increment.
                                    oStat.setData({
                                        nCount:cColl.nTotal||0
                                        ,sFilter:hOpts.sFilter
                                        ,sName:hQuery.sName
                                        ,hour:hIncrement.hour
                                        ,day:hIncrement.day
                                        ,month:hIncrement.month
                                        ,year:hIncrement.year
                                    });
                                    if (hIncrement.year)
                                        oStat.set('date',moment.utc(hIncrement).valueOf());

                                    oStat.save(cb2);
                                } else
                                    cb2();
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
                                    aIncrements.push({year: dNow.year(), month: dNow.month(), day: dNow.date(), hour:dNow.hour(), sGrain:'hour'});
                                }
                                if (nDay != dNow.date() && hSettings.hGrains.day && (!hOpts.sGrain || hOpts.sGrain=='day')) {
                                    nDay = dNow.date();
                                    aIncrements.push({year: dNow.year(), month: dNow.month(), day: dNow.date(), hour: null,sGrain:'day'});
                                }
                                if (nMonth != dNow.month() && hSettings.hGrains.month && (!hOpts.sGrain || hOpts.sGrain=='month')) {
                                    nMonth = dNow.month();
                                    aIncrements.push({year: dNow.year(), month: dNow.month(), day: null, hour: null,sGrain:'month'});
                                }
                                if (nYear != dNow.year() && hSettings.hGrains.year && (!hOpts.sGrain || hOpts.sGrain=='year')){
                                    nYear = dNow.year();
                                    aIncrements.push({year: dNow.year(), month: null, day: null, hour: null,sGrain:'year'});
                                }
                                dNow.add(1,sGrain);
                            }
                            async.forEachLimit(aIncrements,10,processMySqlMetric,cb);
                        }

                    } else
                        processMySqlMetric({year:null,day:null,month:null,hour:null,sGrain:'alltime'},cb);

                },callback);
            else
                callback();
        }
        // Redis-based stats. These guys are different in that we'll simply pull all METRIC keys from
        // Redis and process them - deleting those for time periods that are completely past.
        ,function(callback){
            if (aRedisMetrics.length)
                async.forEachLimit(aRedisMetrics,2,function(hItem,cb){

                    var hSettings = hItem.hSettings;
                    var sDbAlias = (hSettings && hSettings.sDbAlias) ? hSettings.sDbAlias : (Config.hMetrics && Config.hMetrics.sDbAlias) ? Config.hMetrics.sDbAlias : 'default';

                    var aKeyParts = [];
                    // Build the unique key for this increment in redis.
                    aKeyParts.push('METRIC');
                    aKeyParts.push(hOpts.sFilter||'');

                    if (hItem.sClass)
                        aKeyParts.push(hItem.sClass+'.'+hItem.sName);
                    else
                        aKeyParts.push(hItem.sName);

                    // Look up all stored keys for this metric.
                    Redis.keys(aKeyParts.join('|')+'*',function(err,aKeys){

                        if (aKeys && aKeys.length)
                            async.forEachLimit(aKeys,100,function(sKey,cb2){
                                sKey = sKey.replace(/\{\d+\}/,'');
                                Redis.hgetall(sKey,function(err,res){
                                    if (err)
                                        cb2(err);
                                    else {
                                        var nCount = (hSettings.bUniques) ? Object.keys(res).length : 0;
                                        if (!hSettings.bUniques) {
                                            for (var sFilter in res) {
                                                if (res[sFilter]) nCount += Number(res[sFilter]);
                                            }
                                        }
                                        // Figure out the increment we're looking at here.
                                        // e.g. {1}METRIC|clientB|returning_users|2014|5|24|0
                                        var aParts = sKey.split('|');
                                        var hQuery = {year:(aParts[3]||null),month:(aParts[4]||null),day:(aParts[5]||null),hour:(aParts[6]||null)};
                                        if (aParts[1])
                                            hQuery.sFilter = aParts[1];
                                        if (aParts[2])
                                            hQuery.sName = aParts[2];

                                        Base.lookup({sClass:'Metric',sSource:'MySql',hQuery:hQuery},function(err,oStat){
                                            if (err)
                                                cb2(err);
                                            else {

                                                hQuery.nCount = nCount;

                                                var dDate = moment.utc(hQuery).valueOf();
                                                oStat.setData(hQuery);
                                                if (hSettings.bStoreMeta)
                                                    oStat.set('sMeta',JSON.stringify(res));

                                                if (hQuery.year)
                                                    oStat.set('date',dDate);

                                                oStat.save(function(err){
                                                    if (err)
                                                        cb2(err);
                                                    else {
                                                        // If the time period is COMPLETELY PAST, delete the key from Redis.
                                                        var dNow = moment.utc();
                                                        var bDelete = sKey.match(/\|returning\|/);
                                                        if (hQuery.hour && dDate.valueOf() < dNow.clone().startOf('hour').valueOf())
                                                            bDelete = true;
                                                        else if (hQuery.day && dDate.valueOf() < dNow.clone().startOf('day').valueOf())
                                                            bDelete = true;
                                                        else if (hQuery.month && dDate.valueOf() < dNow.clone().startOf('month').valueOf())
                                                            bDelete = true;
                                                        else if (hQuery.year && dDate.valueOf() < dNow.clone().startOf('year').valueOf())
                                                            bDelete = true;

                                                        if (bDelete) {
                                                            console.log('DELETE',hQuery);
                                                            Redis.del(sKey,cb2,sDbAlias);
                                                        } else {
                                                            console.log('LEAVE',hQuery);
                                                            cb2();
                                                        }

                                                    }
                                                });


                                            }
                                        });

                                    }
                                },sDbAlias);
                            },cb);
                        else
                            cb(err);

                    },sDbAlias);

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
    var sDbAlias = (hOpts && hOpts.sDbAlias) ? hOpts.sDbAlias : (Config.hMetrics && Config.hMetrics.sDbAlias) ? Config.hMetrics.sDbAlias : 'default';
    async.series([
        // DELETE ALL STATS FROM MetricTbl in MySql
        function(callback) {
            Config.MySql.execute('DELETE FROM MetricTbl',null,callback,sDbAlias);
        }
        // DELETE ALL METRICS FROM Redis
        ,function(callback) {
            Redis.keys('METRIC*',function(err,aKeys){
                if (err)
                    callback(err);
                else if (aKeys.length)
                    async.forEach(aKeys,function(sKey,cb){
                        Redis.del(sKey,cb);
                    },callback);
                else
                    callback();
            },sDbAlias);
        }
    ],fnCallback);
};