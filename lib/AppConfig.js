var winston = require('winston'),
    events  = require('events'),
    validator = require('validator'),
    util    = require('util'),
    fs      = require('fs');

function AppConfig() {
    this.loadOptions();
}
util.inherits(AppConfig, events.EventEmitter);
var p = AppConfig.prototype;

/**
 * You must configure your Nordis-based app via the AppConfig.init method or by setting environment variables.
 * If you don't have your environment variables set then you MUST start your app with with a call to AppConfig.init and include
 * the following options:
 *
 * NORDIS_ENV_ROOT_DIR - the full path of your library, if you intend on creating classes that inherit from Base but override any Base methods, or provide additional methods.
 * NORDIS_ENV_CONF - the full path of your base configuration file.
 * NORDIS_ENV_CONF_OVERRIDE - (optional) the full path of any environment-specific override configuration file. With this you can override specific settings (such as db connection settings) for your localhost, dev or production environment.
 * NORDIS_ENV - (optional) string name of your environment. If set, the app initialization will look for this environment name in your config file and use its settings (this is another way to override your base/global settings).
 *
 * @param hOpts - pass in the environment variables described above if: 1) you don't already have them set in your
 * environment or 2) if you want to override your environment settings.
 */
p.loadOptions = function(hOpts) {
    var oSelf = this;
    // Convenience logging methods. Just require AppConfig class in your file and call AppConfig.info, AppConfig.debug, AppConfig.error etc.
    oSelf.logger = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({ level:'warn' })
        ]
    });
    oSelf.logger.level = oSelf.sLogLevel||'warn';

    // Default to 'local' env name.
    oSelf.NORDIS_ENV = (hOpts && hOpts.NORDIS_ENV) ? hOpts.NORDIS_ENV : (process.env.NORDIS_ENV) ? process.env.NORDIS_ENV : 'local';
    process.env.NORDIS_ENV = oSelf.NORDIS_ENV;

    // Pass in or set in environemnt (NORDIS_ENV_ROOT_DIR) the directory path where class overrides and event adapters live.
    oSelf.NORDIS_ENV_ROOT_DIR = (hOpts && hOpts.NORDIS_ENV_ROOT_DIR) ? hOpts.NORDIS_ENV_ROOT_DIR : (process.env.NORDIS_ENV_ROOT_DIR) ? process.env.NORDIS_ENV_ROOT_DIR : null;
    // Pass in options or set in environment (NORDIS_ENV_CONF) the file location of root configuration file.
    oSelf.NORDIS_ENV_CONF = (hOpts && hOpts.NORDIS_ENV_CONF) ? hOpts.NORDIS_ENV_CONF : (process.env.NORDIS_ENV_CONF) ? process.env.NORDIS_ENV_CONF : null;
    // Pass in options or set in environment (NORDIS_ENV_CONF_OVERRIDE) the file location of environment-specific override file (optional).
    oSelf.NORDIS_ENV_CONF_OVERRIDE = (hOpts && hOpts.NORDIS_ENV_CONF_OVERRIDE) ? hOpts.NORDIS_ENV_CONF_OVERRIDE : process.env.NORDIS_ENV_CONF_OVERRIDE;
    // Pass in default environment name or set in environment (NORDIS_ENV).
    oSelf.NORDIS_ENV = (hOpts && hOpts.NORDIS_ENV) ? hOpts.NORDIS_ENV : process.env.NORDIS_ENV;

    if (!oSelf.NORDIS_ENV_ROOT_DIR || !fs.existsSync(oSelf.NORDIS_ENV_ROOT_DIR)) {
        oSelf.warn('Root class path is not set in environment. Set either in environment or via the AppConfig.init method on app start-up. Using library default path (so unit tests work)');
        oSelf.NORDIS_ENV_ROOT_DIR = './../';
    }
    if (!oSelf.NORDIS_ENV_CONF || !fs.existsSync(oSelf.NORDIS_ENV_CONF)) {
        oSelf.warn('Environment config file location not set. Set via NORDIS_ENV_CONF variable or via the AppConfig.init method on app start-up. Using local library default (so unit tests work).');
        oSelf.NORDIS_ENV_CONF = './../examples/conf.js';
    }

    try {
        var hConf = require(oSelf.NORDIS_ENV_CONF);
        hConf = hConf.hSettings;
        // config root should be 'global'
        for (var sProp in hConf.global) {
            oSelf[sProp] = hConf.global[sProp];
        }
        // Look for section matching the NORDIS_ENV and use it to override global defaults.
        if (oSelf.NORDIS_ENV && hConf[oSelf.NORDIS_ENV]) {
            oSelf.warn('Override settings using '+oSelf.NORDIS_ENV+' section of config.');
            _appendHash(oSelf,hConf[oSelf.NORDIS_ENV]);
        }
    } catch (err) {
        oSelf.warn(err);
    }

    // Check for an environment-specific override .conf file. This is where we change whatever
    // we need to for the environment.
    if (oSelf.NORDIS_ENV_CONF_OVERRIDE) {
        try {
            var hEnvConf = require(oSelf.NORDIS_ENV_CONF_OVERRIDE);
            oSelf.warn('Appending override settings from '+oSelf.NORDIS_ENV_CONF_OVERRIDE);
            _appendHash(oSelf,hEnvConf.hSettings.global);
            // Again, look for section matching the NORDIS_ENV and use it to override global defaults.
            // This overrides the overrides above (in the default file).
            if (oSelf.NORDIS_ENV && hEnvConf.hSettings[oSelf.NORDIS_ENV]) {
                oSelf.warn('Found NORDIS_ENV ('+oSelf.NORDIS_ENV+') and settings therein.');
                _appendHash(oSelf,hEnvConf.hSettings[oSelf.NORDIS_ENV]);
            }
        } catch (err) {
            oSelf.warn(err);
        }
    }

    // Re-instantiate logging using the configured settings.
    if (oSelf.sLogLevel && oSelf.sLogLevel != oSelf.logger.level) {
        oSelf.logger.level = oSelf.sLogLevel;
        for (var sTransport in oSelf.logger.transports) {
            oSelf.logger.transports[sTransport].level = oSelf.sLogLevel;
        }
    }

    // Singleton instances of Redis class. Redis connections are managed in a pool
    oSelf.Redis = require('./Utils/Data/Redis');
    oSelf.Redis.init(oSelf.hOptions.Redis);

    oSelf.MySql = require('./Utils/Data/MySql');
    oSelf.MySql.init(oSelf.hOptions.MySql);

    if (!oSelf.hClassMap) oSelf.hClassMap = {};
    for (var sClass in oSelf.hClasses) {
        oSelf.processClass(sClass);
    }

    // The Stat class must be defined in order to store scrubbed data in a way that can be retrieved via the framework.
    oSelf.debug('----- APP CLASS MAP -----');

    if (oSelf.hClasses.Stat)
        throw new Error('\'Stat\' is a protected class name in Nordis for purposes of storing usage stats and analytics. Please choose another class name.');
    else {
        oSelf.hClasses.Stat = {
            nClass:0.2
            ,hProperties:{
                id:{bUnique:true,sType:'Number'}
                ,name:{sType:'String',sMySqlType:'CHAR(40)',bIndex:true}
                ,date:{sType:'Timestamp'}
                ,count:{sType:'Number'}
                ,year:{sType:'Number'}
                ,month:{sType:'Number'}
                ,day:{sType:'Number'}
                ,hour:{sType:'Number'}
            }
        };
        oSelf.processClass('Stat');
    }
    // Also, must create a class for the overall Application, on which we'll store the stat-related collections.
    if (oSelf.hClasses.App)
        throw new Error('\'App\' is a protected class name in Nordis for purposes of storing usage stats and analytics. Please choose another class name.');
    else {
        oSelf.hClasses.App = {
            nClass:0.000001
            ,sTable:'_AutoClassTbl'
            ,hProperties:{
                sid:{bUnique:true,sType:'String',sValue:'App',sMySqlType:'CHAR(50)'}
            }
            ,hExtras:{}
        };
        oSelf.processClass('App');
    }

    // These collections are dynamically defined using the hStats section of the config.
    // Create a Custom Class Object for each stat defined, each with extras for each desired granularity.
    var n = 0.000002;

    for (var sStat in oSelf.hStats) {
        if (oSelf.hStats[sStat].fnQuery || oSelf.hStats[sStat].fnValidate) {
            if (oSelf.hClasses[sStat])
                throw new Error('Error trying to create auto-class for stat: '+sStat+'. Name is taken by an existing class. Please name stats uniquely.');
            else {
                // Create custom class for each stat and add it as an extra on the App class.
                // This allows access to any stat and any granularity on the stat using existing
                // lookup standards.
                oSelf.hClasses[sStat] = {
                    nClass:n
                    ,sTable:'_AutoClassTbl'
                    ,hProperties:{
                        sid:{bUnique:true,sType:'String',sValue:sStat,sMySqlType:'CHAR(50)'}
                    }
                    ,hExtras:{}
                };

                // Add extras for each granularity.
                ['hour','day','month','year'].forEach(function(sGrain){
                    oSelf.hClasses[sStat].hExtras[sGrain] = {
                        sType:'Collection'
                        ,sClass:'Stat'
                        ,sOrderBy:'date'
                        ,bReverse:true
                        ,fnQuery:function(oParent,AppConfig,sProperty){
                            var hQuery = {name:oParent.sClass}
                            switch (sProperty) {
                                case 'hour':
                                    hQuery.hour = 'NOT NULL';
                                    break;
                                case 'day':
                                    hQuery.hour = null;
                                    break;
                                case 'month':
                                    hQuery.day = null;
                                    break;
                                case 'year':
                                    hQuery.month = null;
                                    break;
                            }
                            return hQuery;
                        }
                    }
                });
                oSelf.processClass(sStat);

                oSelf.hClasses.App.hExtras[sStat] = {
                    sType:'Object'
                    ,sClass:sStat
                    ,hData:{sid:sStat}
                };
                oSelf.processClass('App');

            }
        }
        n += 0.000001;
    }

    oSelf.debug(oSelf.hClassMap);
    oSelf.debug('----- END APP CLASS MAP -----');
};

var _appendHash = function (hExisting, hNew) {
    for (var sKey in hNew) {
        if (sKey != 'hProperties' && hExisting[sKey] && hExisting[sKey] instanceof Object)
            _appendHash(hExisting[sKey], hNew[sKey]);
        else {
            hExisting[sKey] = hNew[sKey];
            if (sKey == 'hProperties')
                delete hExisting['aProperties'];
        }
    }
};

p.processClass = function(sClass) {
    var oSelf = this;
    var hSettings = oSelf.hClasses[sClass];

    if (hSettings.nClass == undefined) {
        throw new Error('Class improperly configured. Missing nClass value for '+sClass);
    } else {
        oSelf.hClassMap[hSettings.nClass] = sClass;
        oSelf.hClassMap[sClass.toLowerCase()] = sClass;
    }
    if (!hSettings.aSecondaryLookupKeys)
        hSettings.aSecondaryLookupKeys = [];

    if (!hSettings.hProperties)
        throw new Error('Class improperly configured. Missing nClass value for '+sClass);

    hSettings.aProperties = [];
    hSettings.aRequiredProperties = [];
    for (var sProp in hSettings.hProperties) {
        hSettings.aProperties.push(sProp);
        switch (hSettings.hProperties[sProp].sType) {
            case 'String':
                if (hSettings.hProperties[sProp].bUnique) {
                    if (!hSettings.hProperties[sProp].sValue)
                        hSettings.aSecondaryLookupKeys.push(sProp);
                    if (hSettings.hProperties[sProp].nLength || hSettings.hProperties[sProp].sValue)
                        hSettings.sStrKeyProperty = sProp;
                }
                break;
            case 'Number':
                if (hSettings.hProperties[sProp].bUnique)
                    hSettings.sNumKeyProperty = sProp;
                break;
            case 'Timestamp':
                if (hSettings.hProperties[sProp].bOnCreate)
                    hSettings.sCreateTimeProperty = sProp;
                else if (hSettings.hProperties[sProp].bOnUpdate)
                    hSettings.sUpdateTimeProperty = sProp;
                break;
        }
        if (hSettings.hProperties[sProp].bRequired)
            hSettings.aRequiredProperties.push(sProp);

//        // Process all the extras on the class and add to hClassMap if needed.
//        for (var sExtra in hSettings.hExtras) {
//            if (hSettings.hExtras[sExtra].sType.match(/(Object|Collection)/))
//                oSelf.hClassMap[sClass.toLowerCase()+'.'+sExtra] = hSettings.hExtras[sExtra].sClass;
//        }
    }

    if (!hSettings.sNumKeyProperty && !hSettings.sStrKeyProperty)
        throw new Error('No unique number or string property set for '+sClass+'. At least one is required per class so we cannot continue.');

};

p.init = function (hOpts,fnCallback) {
    var oSelf = this;
        process.env.sViewPath = (hOpts && hOpts.sViewPath) ? hOpts.sViewPath : null;
        if (hOpts && (hOpts.NORDIS_ENV_ROOT_DIR || hOpts.NORDIS_ENV_CONF || hOpts.NORDIS_ENV_CONF_OVERRIDE))
            this.loadOptions(hOpts);

    if (process.env.sApp)
        oSelf.log('\nSTARTING: ' + process.env.sApp + oSelf.getEnvDescription(hOpts) +'\n------------###-------------');

    if (fnCallback)
        fnCallback();
};

p.silly = function (sMsg, oObj) {
    if (sMsg)
        this.logger.silly(sMsg, (oObj||null));
};

p.verbose = function (sMsg, oObj) {
    if (sMsg)
        this.logger.verbose(sMsg, (oObj||null));
};

p.debug = function (sMsg, oObj) {
    this.logger.debug(sMsg, (oObj||null));
};

p.info = function (sMsg, oObj) {
    if (sMsg)
        this.logger.info(sMsg, (oObj||null));
};

p.warn = function (sMsg, oObj) {
    if (sMsg)
        this.logger.warn(sMsg, (oObj||null));
};

p.error = function (sMsg, oObj) {
    if (sMsg || oObj) {
        if (!oObj)
            oObj = {sMsg:sMsg};
        else if (oObj.sMessage)
            sMsg = oObj.sMessage;

        sMsg = (sMsg) ? sMsg.toString() : '';
        this.logger.error(sMsg.toString(), (oObj||null));
    }
};
/**
 * Logs error, tries to grab a stack trace, and emits an 'onFatalError' event if you want
 * to notify someone regarding the error.
 * @param sMsg
 * @param oObj
 */
p.fatal = function (sMsg, oObj) {
    if (!oObj && sMsg) {
        if (sMsg instanceof Object)
            oObj = sMsg;
        else
            oObj = {sMsg:sMsg};
    }
    oObj = {stack:new Error().stack, oObj:oObj, sMsg:JSON.stringify(sMsg)};
    this.logger.error('FATAL: ' + sMsg.toString(), oObj);
    this.emit('onFatalError',oObj);
};
/**
 * Replacement for console.log. Adds line break and serializes the oObj param, if passed in.
 * @param sMsg
 * @param oObj
 */
p.log = function(sMsg,oObj) {
    if (sMsg)
        console.log('\n'+sMsg);
    if (oObj) {
        console.log('\n');
        console.log(oObj);
    }
};

p.wrapTest = function(err,test) {
    if (err)
        this.fatal(err);
    test.done();
};

p.getError = function(nCode,sLanguage) {
    if (this.hErrorStrings && this.hErrorStrings[nCode]) {
        sLanguage = (sLanguage) ? sLanguage : (this.sLanguage) ? this.sLanguage : 'en';
        return this.hErrorStrings[nCode][sLanguage];
    } else
        switch (nCode) {
            case 500:
                return 'Malformed request.';
            break;
            default:
                return 'Unhandled exception ('+nCode+'). No exception message provided.';
                break;
        }
};

p.exit = function () {
    process.exit();
};
/**
 * This method prints out all the relevant details about the environment when the AppConfig.init method is called. This includes the active environment
 * variables, configuration file location(s), application port number & version, nordis version, database/redis locations, log level and view directory location (for web apps).
 *
 * @param hOpts
 * @returns {string}
 */
p.getEnvDescription = function(hOpts){
    var oSelf = this;
    var sPort = (oSelf.hAppSettings && oSelf.hAppSettings[process.env.sApp] && oSelf.hAppSettings[process.env.sApp].nPort) ? '\n PORT: ' + oSelf.hAppSettings[process.env.sApp].nPort : '';
    var sViews = (process.env.sViewPath && process.env.sViewPath.match(/\//)) ? '\n VIEW DIR: '+process.env.sViewPath : '';
    var sWorkerId = (hOpts && hOpts.sWorkerId) ? '\n PROCESS ID: '+hOpts.sWorkerId : '';
    var sRedisConf = '\n REDIS: '+oSelf.hOptions.Redis.sWriteServer+':'+oSelf.hOptions.Redis.nWritePort;
    var sMySqlConf = (oSelf.hOptions.MySql.bSkip) ? '\n MYSQL: OFF' : '\n MYSQL: '+oSelf.hOptions.MySql.sHost+':'+oSelf.hOptions.MySql.sSchema;
    var sLogLevel = '\n LOG LEVEL: '+oSelf.sLogLevel;

    var sNordis = '';
    if (fs.existsSync(process.env.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json')) {
        var hNordisInstance = require(process.env.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json');
        sNordis = '\n NORDIS VERSION: '+hNordisInstance.version;
    }
    var sApp = '';
    if (fs.existsSync(process.env.NORDIS_ENV_ROOT_DIR+'/package.json')) {
        var hAppInstance = require(process.env.NORDIS_ENV_ROOT_DIR+'/package.json');
        sApp = '\n APP VERSION: '+hAppInstance.version;
    }
    var sEnv = '\n NORDIS_ENV: ' + process.env.NORDIS_ENV+'\n NORDIS_ENV_CONF: ' + process.env.NORDIS_ENV_CONF;
    if (process.env.NORDIS_ENV_CONF_OVERRIDE)
        sEnv += '\n NORDIS_ENV_CONF_OVERRIDE: '+process.env.NORDIS_ENV_CONF_OVERRIDE;

    return sEnv+sApp+sNordis+sPort+sViews+sWorkerId+sRedisConf+sMySqlConf+sLogLevel;
};

p.publish = function (oObj, hMsg, fnCallback) {
    var oSelf = this;
    var sID = oObj.nClass+':'+(oObj.getStrKey()||oObj.getKey());
    var sData;
    var hObj;
    if (hMsg.hData) {
        var nClass = hMsg.nClass;
        var sClass = hMsg.sClass;
        try {
            hObj = hMsg.toApiHash();
        } catch (err) {
            hObj = hMsg.hData;
        }
        hObj.nClass = nClass;
        hObj.sClass = sClass;

        sData = JSON.stringify(hObj);
    } else if (hMsg.sChanged && hMsg.Value && hMsg.Value.hData) {
        hObj = {sClass:hMsg.Value.sClass,nClass:hMsg.Value.nClass,hData:hMsg.Value.hData};
        hObj = {sClass:'Status',sChanged:hMsg.sChanged,Value:hObj};
        sData = JSON.stringify(hObj);
    } else {
        try {
            sData = JSON.stringify(hMsg);
        } catch(err) {
            if (err)
                oSelf.warn(err);
        }
    }

    if (hMsg && hMsg.sLog)
        this.info(hMsg.sLog);
    if (oObj && oObj.txid)
        sID = oObj.txid;

    if (sID && sData) {
        oSelf.Redis.publish(sID, sData, function () {
            if (fnCallback)
                fnCallback();
        });
    }
};
/**
 * Core method for tracking stats. This method will call Redis.incr method if the passed-in
 * params pass muster, as defined in the configuration file.
 * @param aParms
 * @param fnCallback
 * @param dDate - (optional) date object, if you want to force a date assignment on the stat (unit test, retro-active stat building, etc). Default is now (UTC).
 */
p.trackStat = function(sStat,aParams,fnCallback,dDate){
    var oSelf = this;
    dDate = (dDate) ? dDate : new Date();

    var returnError = function(sErr) {
        if (sErr) {
            if (fnCallback)
                fnCallback(sErr);
            else
                oSelf.error(sErr);
        }
    };

    if (!oSelf.hStats[sStat])
        returnError('Stat not configured: '+sStat);
    else if (!oSelf.hStats[sStat].fnValidate)
        returnError('fnValidate not defined for stat: '+sStat);
    else
        oSelf.hStats[sStat].fnValidate(aParams,function(err,sKey){
            if (err)
                returnError(err);
            else {

                // Create name key for redis for each granularity. Config will determine which are processed and kept.
                var aKeys = [
                    sStat+','+dDate.getUTCFullYear()
                    ,sStat+','+dDate.getUTCFullYear()+','+dDate.getUTCMonth()
                    ,sStat+','+dDate.getUTCFullYear()+','+dDate.getUTCMonth()+','+dDate.getUTCDate()
                    ,sStat+','+dDate.getUTCFullYear()+','+dDate.getUTCMonth()+','+dDate.getUTCDate()+','+dDate.getUTCHours()
                ];

                if (aKeys.length) {
                    if (sKey)
                        oSelf.Redis.hincrby(aKeys,sKey,1,fnCallback);
                    else {
                        oSelf.Redis.incr(aKeys,fnCallback);
                    }
                }
            }
        });
};
/**
 * This method walks through all the stats in the configuration file
 * and creates collections of stat data in redis.
 * @param fnCallback
 */
p.processStats = function(dStart,dEnd,fnCallback) {
    var oSelf = this;
    var async = require('async');
    var Base = require('./Base');
    var oApp;

    // If no start/end are provided, just process everything.
    if (dStart instanceof Function) {
        fnCallback = dStart;
        dStart = new Date(0);
        dEnd = new Date();
    }

    oSelf.info('Processing stats for '+dStart.toString()+' thru '+dEnd.toString());

    // Each stat ends up as a record in the StatTbl. This method is used for both redis stats and db stats to store the processed output.
    var processStat = function(hOpts,callback) {

        Base.lookup({sClass:'Stat',hQuery:{name:hOpts.name,year:hOpts.year,month:hOpts.month,day:hOpts.day,hour:hOpts.hour}},function(err,oStat){
            if (err)
                callback(err);
            else {
                var nOldCount = (validator.isInt(oStat.get('count'))) ? validator.toInt(oStat.get('count')) : 0;
                var nAdd = (validator.isInt(hOpts.count)) ? validator.toInt(hOpts.count) : 0;

                oStat.setData(hOpts);
                oStat.set('count',nOldCount+nAdd);
                async.series([
                    // Make sure the stat is available on the app singleton.
                    function(cb) {
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
                        oSelf.Redis.del(hOpts.sKey,cb);
                    }
                ],callback);

            }
        });
    };

    var aDbStats = [];
    var aRedisStats = [];

    async.series([
        // STEP ZERO. Load up our app singleton instance, onto which we'll save stat records into our stat collections.
        function(callback) {
            Base.lookup({sClass:'App'},function(err,oResult){
                oApp = oResult;
                callback();
            });
        }
        // STEP ONE. The config tells us which kind of stat is which.  So we'll first loop through and create a set of arrays of stat names to process.
        ,function(callback) {
            for (var sStat in oSelf.hStats) {
                if (oSelf.hStats[sStat].fnQuery)
                    aDbStats.push(sStat);
                else if (oSelf.hStats[sStat].fnValidate)
                    aRedisStats.push(sStat);
            }
            callback();
        }
        // STEP TWO. Process redis-based stats. We could process db-based stats in parallel, but for readability this is done in series.
        ,function(callback) {
            async.forEach(aRedisStats,function(sStat,cb) {

                async.waterfall([
                    // Step 1. We need to pull the key from Redis. This is not a fast query and so should be run at off hours
                    // or on a separate server altogether - and you could even query a backup Redis instance so as not to tax the
                    // primary redis box.
                    function(cback) {
                        oSelf.Redis.keys(sStat+',*',cback);
                    }
                    // Step 2, loop through keys that are at or above the desired granularity.
                    ,function(aKeys,cback) {
                        async.forEach(aKeys,function(sKey,cback2){
                            // If the stat isn't a simple counter, look up the number of name-value pairs using the Redis HLEN command.
                            // Otherwise, just use GET.
                            async.parallel([
                                function(cback3){
                                    // Call the validate function without params. if it doesn't error out and returns empty key it's a simple count.
                                    oSelf.hStats[sStat].fnValidate(null,function(err){
                                        if (err)
                                            oSelf.Redis.hlen(sKey,cback3);
                                        else
                                            oSelf.Redis.get(sKey,cback3);
                                    });
                                }
                            ],function(err,nCount){
                                if (err || !nCount)
                                    cback2(err);
                                else {

                                    var aParts = sKey.split(',');
                                    var dDate = new Date(aParts[1],aParts[2]||null,aParts[3]||null,aParts[4]||null);
                                    var sGrain = (aParts[2]==undefined) ? 'year' : (aParts[3]==undefined) ? 'month' : (aParts[4]==undefined) ? 'day' : 'hour';

                                    processStat({
                                        sKey:sKey
                                        ,sGrain:sGrain
                                        ,count:nCount
                                        ,name:sStat
                                        ,year:aParts[1]||null
                                        ,month:aParts[2]||null
                                        ,day:aParts[3]||null
                                        ,hour:aParts[4]||null
                                        ,date:dDate.getTime()
                                    },cback2);

                                }
                            });
                        },cback);
                    }
                ],cb);

            },callback);
        }
        // STEP THREE. Process db-based stats.
//        ,function(callback) {
//            callback()
//        }
    ],fnCallback);
};
/**
 * This method is used by unit tests to remove any and all stat/analytic data before and after a test run. Don't use
 * this at all, or use it with great care!
 *
 * @param fnCallback
 */
p.flushStats = function(fnCallback){
    var oSelf = this;
    var async = require('async');
    var Base = require('./Base');

    async.series([
        function(cb) {
            var dStart = new Date(new Date().getTime()-100000000);
            var dEnd = new Date();
            oSelf.processStats(dStart,dEnd,cb);
        }
        ,function(cb) {
            Base.lookup({sClass:'App'},function(err,oResult){
                oSelf.oApp = oResult;
                cb(err,null);
            });
        }
        ,function(cb) {
            // Flush all stats.
            var q = async.queue(function(hOpts,cback){
                if (hOpts.sStat && hOpts.sGrain) {
                    var hExtras = {};
                    hExtras[hOpts.sStat] = {hExtras:{}};
                    hExtras[hOpts.sStat].hExtras[hOpts.sGrain] = true;

                    oSelf.oApp.loadExtras(hExtras,function(err){
                        if (err)
                            cback(err);
                        else if (oSelf.oApp[hOpts.sStat] && oSelf.oApp[hOpts.sStat][hOpts.sGrain])
                            oSelf.oApp[hOpts.sStat][hOpts.sGrain].delete(cback);
                        else
                            cback();
                    });
                } else
                    cback();
            },1);
            q.drain = cb;

            for (var sStat in oSelf.hStats) {
                ['hour','day','month','year'].forEach(function(sGrain){
                    q.push({sStat:sStat,sGrain:sGrain});
                });
                q.push({});
            }
        }
    ],fnCallback);
};
/**
 * This script outputs an apiary.io-compatible file (apiary.apib) for easy-to-read API documentation.
 */
p.writeApiaryDocs = function(sPath,fnCallback) {
    var oSelf = this;
    var fs = require('fs');
    var Base = require('./Base');

    if (!sPath)
        fnCallback('No destination directory path provided. Please provide full, absolute path.');
    else if (!fs.existsSync(sPath))
        fnCallback('Destination directory path provided does not exist. Please provide full, absolute path.');
    else {

        fs.lstat( sPath, function (err, status) {
            if (err) {
                // file does not exist-
                if (err.code === 'ENOENT' )
                    fnCallback('No file or directory at',sPath);
                else
                    fnCallback(err);// miscellaneous error (e.g. permissions)
            } else {
                if (status.isDirectory())
                    sPath += '/apiary.apib';

                console.log('Beginning write of api docs at '+sPath);

                // Later, we'll create array of class names so we can process using async.forEach.
                var aClasses = [];

                var async = require('async');
                async.series([
                    function(callback) {
                        oSelf.init(null,callback);
                    }
                    // Write top-level info about the API.
                    ,function(callback) {
                        // Empty the file.
                        fs.writeFileSync(sPath,'');
                        // Write the first line.
                        fs.appendFileSync(sPath,'FORMAT: 1A\n');
                        // And the hostname for the api.
                        if (oSelf.hApi && oSelf.hApi.sHost)
                            fs.appendFileSync(sPath,'HOST: '+oSelf.hApi.sHost+'\n\n');
                        // And the title for the api.
                        if (oSelf.hApi && oSelf.hApi.sTitle)
                            fs.appendFileSync(sPath,'# '+oSelf.hApi.sTitle+'\n');
                        // And the description for the api.
                        if (oSelf.hApi && oSelf.hApi.sDescription)
                            fs.appendFileSync(sPath,oSelf.hApi.sDescription+'\n\n');
                        callback();
                    }
                    // Write documentation for all the classes that have an hApi section in the conf file.
                    ,function(callback) {
                        for (var sClass in oSelf.hClasses) {
                            if (oSelf.hClasses[sClass].hApi)
                                aClasses.push(sClass);
                        }
                        if (aClasses.length)
                            callback();
                        else
                            callback('No classes have an hApi section. Nothing to do.');
                    }
                    ,function(callback) {
                        async.forEach(aClasses,function(sClass,cback){
                            console.log(sClass+'...');

                            // Write class-level details.
                            fs.appendFileSync(sPath,'# Group '+sClass+'\n');
                            if (oSelf.hClasses[sClass].hApi.sDescription)
                                fs.appendFileSync(sPath,oSelf.hClasses[sClass].hApi.sDescription+'\n\n');

                            var aEndpoints = [];
                            // Create entries for each endpoint/path.
                            for (var sEndpoint in oSelf.hClasses[sClass].hApi.hEndpoints) {
                                aEndpoints.push(sEndpoint);
                            }

                            if (aEndpoints.length)
                                async.forEach(aEndpoints,function(sEndpoint,cb) {
                                    fs.appendFileSync(sPath,'## '+sClass+' ['+sEndpoint+']\n');
                                    fs.appendFileSync(sPath,oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].sDescription+'\n\n');

                                    if (oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters) {
                                        fs.appendFileSync(sPath,'+ Parameters\n');

                                        for (var sParam in oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters) {
                                            var hParam = oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters[sParam];
                                            fs.appendFileSync(sPath,'    + '+sParam+' (');
                                            if (hParam.bRequired)
                                                fs.appendFileSync(sPath,'required');
                                            else
                                                fs.appendFileSync(sPath,'optional');

                                            fs.appendFileSync(sPath,','+hParam.sType);
                                            fs.appendFileSync(sPath,',`'+hParam.sExample+'`) ... ');

                                            fs.appendFileSync(sPath,hParam.sDescription+'\n');
                                        }
                                        fs.appendFileSync(sPath,'\n');
                                    }

                                    if (oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs) {
                                        for (var sVerb in oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs) {
                                            var hVerb = oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs[sVerb];
                                            fs.appendFileSync(sPath,'### '+hVerb.sTitle+' ['+sVerb+']\n');
                                            if (hVerb.sDescription)
                                                fs.appendFileSync(sPath,hVerb.sDescription+'\n');

                                            switch (sVerb) {
                                                case 'GET':case 'POST':
                                                fs.appendFileSync(sPath,'+ Response 200 (application/json)\n');
                                                fs.appendFileSync(sPath,'    + Body\n\n');

                                                // Build sample objects based on the sEndpoint. This is why we set an 'sSample' property in the class.property definitions.
                                                var oObj = Base.lookup({sClass:sClass});
                                                // Now, serialize with either the provided override or the default toHash method.
                                                if (hVerb.hSample)
                                                    fs.appendFileSync(sPath,'            '+JSON.stringify(hVerb.hSample)+'\n\n');
                                                else {
                                                    var hResult = oObj.toSampleHash();
                                                    if (hVerb.fnApiCallOutput) {
                                                        if (!hVerb.fnApiCallOutput.toString().match(/return /))
                                                            throw new Error('To properly create Apiary docs, each fnApiCallOutput in your config file method should include a synchronous path with a return statement, and return sample data for documentation purposes.');
                                                        else {
                                                            hResult = hVerb.fnApiCallOutput({hNordis:{oResult:oObj}});
                                                        }
                                                    }
                                                    fs.appendFileSync(sPath,'            '+JSON.stringify(hResult)+'\n\n');
                                                }
                                                break;
                                                case 'DELETE':
                                                    fs.appendFileSync(sPath,'+ Response 204\n');
                                                    break;
                                            }
                                            fs.appendFileSync(sPath,'\n');
                                        }
                                    }
                                    cb();
                                },cback);
                            else
                                cback();

                        },callback);
                    }
                ],fnCallback);
            }
        });
    };
};
var oSelf = new AppConfig();

module.exports = oSelf;