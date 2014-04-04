var winston = require('winston'),
    moment  = require('moment'),
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

    // Build top-level api calls into the endpoint map.
    if (oSelf.hApi && oSelf.hApi.hEndpoints) {
        if (!oSelf.hEndpointMap) oSelf.hEndpointMap = {};
        for (var sEndpoint in oSelf.hApi.hEndpoints) {
            var sClass = oSelf.hApi.hEndpoints[sEndpoint].sClass;
            var aPaths = sEndpoint.split('/');
            (function buildMap(hMap, nIndex) {
                if (aPaths[nIndex + 1]) {
                    if (!hMap[aPaths[nIndex]]) hMap[aPaths[nIndex]] = {};
                    buildMap(hMap[aPaths[nIndex]], (nIndex + 1));
                } else if (!hMap[aPaths[nIndex]])
                    hMap[aPaths[nIndex]] = {'/': sClass};
            })(oSelf.hEndpointMap, 1);
        }
    }

    // The Stat class must be defined in order to store scrubbed data in a way that can be retrieved via the framework.
    oSelf.debug('----- APP CLASS MAP -----');

    if (oSelf.hClasses.Stat)
        throw new Error('\'Stat\' is a protected class name in Nordis for purposes of storing usage stats and analytics. Please choose another class name.');
    else {
        oSelf.hClasses.Stat = {
            sDbAlias:(oSelf.hStats && oSelf.hStats.sDbAlias) ? oSelf.hStats.sDbAlias : 'default'
            ,hProperties:{
                id:{bPrimary:true,sType:'Number'}
                ,name:{sType:'String',sMySqlType:'CHAR(40)',bIndex:true}
                ,app_id:{sType:'Number'}
                ,date:{sType:'Timestamp'}
                ,count:{sType:'Number'}
                ,year:{sType:'Number'}
                ,month:{sType:'Number'}
                ,day:{sType:'Number'}
                ,hour:{sType:'Number'}
                ,filters:{sType:'String'}
            }
        };
        oSelf.processClass('Stat');
    }
    // Also, must create a class for the overall Application, on which we'll store the stat-related collections.
    if (oSelf.hClasses.App && oSelf.hClasses.App.hProperties)
        throw new Error('\'App\' is a protected class name in Nordis for purposes of storing usage stats and analytics. Please choose another class name.');
    else {
        oSelf.hClasses.App = {
            sTable:'_SingletonTbl'
            ,hProperties:{
                id:{bPrimary:true,sType:'Number'}
                ,sid:{bUnique:false,sType:'String',sValue:'app',sMySqlType:'CHAR(100)'}
                ,app_id:{sType:'Number'}
            }
            ,hExtras:{}
        };
        oSelf.processClass('App');
    }

    // These collections are dynamically defined using the hStats section of the config.
    // Create a Custom Class Object for each stat defined, each with extras for each desired granularity.
    for (var sStat in oSelf.hStats) {
        if (oSelf.hStats[sStat].fnProcessQuery || oSelf.hStats[sStat].fnValidate) {
            if (oSelf.hClasses[sStat])
                throw new Error('Error trying to create auto-class for stat: ' + sStat + '. Name is taken by an existing class. Please name stats uniquely.');
            else {
                // Create custom class for each stat and add it as an extra on the App class.
                // This allows access to any stat and any granularity on the stat using existing
                // lookup standards.
                oSelf.hClasses[sStat] = {
                    sTable:'_SingletonTbl'
                    ,sDbAlias:oSelf.hStats[sStat].sDbAlias||oSelf.hStats.sDbAlias
                    ,sSource:oSelf.hStats[sStat].sSource||null
                    ,hProperties:{
                        id:{bPrimary:true,sType:'Number'}
                        ,sid:{sType:'String',sValue:sStat,sMySqlType: 'CHAR(100)'}
                        ,app_id:{sType:'Number'}
                    }
                    ,hExtras: {}
                };

                // Add extras for each granularity.
                ['hour', 'day', 'month', 'year', 'alltime'].forEach(function (sGrain) {
                    oSelf.hClasses[sStat].hExtras[sGrain] = {
                        sType:'Collection'
                        ,sClass:'Stat'
                        ,sOrderBy:'date',
                        fnQuery: function (oParent, AppConfig, sProperty) {
                            var hQuery = {name: oParent.sClass, hour: null, day: null, month: null, year: null};
                            if (oParent.get('app_id')) hQuery.app_id = oParent.get('app_id');

                            switch (sProperty) {
                                case 'hour':
                                    hQuery.hour = 'NOT NULL';
                                    hQuery.day = 'NOT NULL';
                                    hQuery.month = 'NOT NULL';
                                    hQuery.year = 'NOT NULL';
                                    break;
                                case 'day':
                                    hQuery.day = 'NOT NULL';
                                    hQuery.month = 'NOT NULL';
                                    hQuery.year = 'NOT NULL';
                                    break;
                                case 'month':
                                    hQuery.month = 'NOT NULL';
                                    hQuery.year = 'NOT NULL';
                                    break;
                                case 'year':
                                    hQuery.year = 'NOT NULL';
                                    break;
                            }

                            return hQuery;
                        }
                    }
                    // Expose stat as api endpoint if configured to do so.
                    if (!oSelf.hClasses.Stat.hApi)
                        oSelf.hClasses.Stat.hApi = {
                            sDescription: 'Analytics endpoints available for retrieval via api. All stats are returned as a collection with the most recent items listed first. Use paging to go backwards in time, or use nMax/nMin to pass a date range using timestamps.\n\n(To disable, add bApi:false to stat config; to protect, add fnApiCallProcessor function to config to validate the request).', hEndpoints: {}
                        };
                    if (!oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'])
                        oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'] = {};
                    if (!oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hVerbs)
                        oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hVerbs = {};

                    oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].sTitle = sStat;
                    oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hParameters = {
                        grain: {
                            bRequired: true, sType: 'String', sExample: 'hour', sDescription: 'String name of desired granularity. Acceptable values include hour, day, month, year or all.'
                        }
                    };
                    oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hVerbs.GET = {sTitle: oSelf.hClasses.Stat.sTitle};
                    oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hVerbs.GET.sTitle = sStat;
                    oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hVerbs.GET.sKey = 'grain';
                    oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hVerbs.GET.sAlias = oSelf.hStats[sStat].sAlias;
                    oSelf.hClasses.Stat.hApi.hEndpoints['/stat/' + sStat + '/{grain}'].hVerbs.GET.sDescription = oSelf.hStats[sStat].sDescription || '';
                    // Make sure the api knows to look for 'grain'
                    if (!oSelf.hClasses.Stat.hApiParams)
                        oSelf.hClasses.Stat.hApiParams = {grain: true};

                    var aPaths = ('/stat/' + sStat + '/{grain}').split('/');
                    (function buildMap(hMap, nIndex) {
                        if (aPaths[nIndex + 1]) {
                            if (!hMap[aPaths[nIndex]]) hMap[aPaths[nIndex]] = {};
                            buildMap(hMap[aPaths[nIndex]], (nIndex + 1));
                        } else if (!hMap[aPaths[nIndex]])
                            hMap[aPaths[nIndex]] = {'/': 'Stat'};
                    })(oSelf.hEndpointMap, 1);

                });

                oSelf.processClass(sStat);
                oSelf.hClasses.App.hExtras[sStat] = {
                    sType:'Object'
                    ,sClass:sStat
                    ,fnQueryOverride:function(oObj,oApp,callback){
                        var Base = require('./Base');
                        var hQuery = {sid:oObj.sClass,app_id:oApp.getKey()}
                        Base.lookup({sClass:oObj.sClass,hQuery:hQuery},function(err,oResult){
                            oResult.hQuery = hQuery;
                            if (err)
                                callback(err);
                            else if (!oResult.getKey()) {
                                oResult.set('sid',oObj.sClass);
                                oResult.set('app_id',oApp.getKey());
                                oResult.save(callback);
                            } else
                                callback(null,oResult);
                        });
                    }
                };
                oSelf.processClass('App');
            }
        }
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

//    if (hSettings.nClass == undefined) {
//        throw new Error('Class improperly configured. Missing nClass value for '+sClass);
//    } else {
    if (hSettings.nClass) oSelf.hClassMap[hSettings.nClass] = sClass;
    oSelf.hClassMap[sClass.toLowerCase()] = sClass;
//    }
    if (!hSettings.aSecondaryLookupKeys)
        hSettings.aSecondaryLookupKeys = [];

    if (!hSettings.hProperties)
        oSelf.warn('Class improperly configured. Missing hProperties hash for '+sClass);

    hSettings.aProperties = [];
    hSettings.aRequiredProperties = [];
    for (var sProp in hSettings.hProperties) {
        hSettings.aProperties.push(sProp);
        switch (hSettings.hProperties[sProp].sType) {
            case 'String':
                if (hSettings.hProperties[sProp].bUnique || hSettings.hProperties[sProp].bSecondary) {
                    hSettings.aSecondaryLookupKeys.push(sProp);
                } else if (hSettings.hProperties[sProp].bPrimary)
                    hSettings.sKeyProperty = sProp;
                if (hSettings.hProperties[sProp].nLength || hSettings.hProperties[sProp].bPrimary)
                    hSettings.sStrKeyProperty = sProp;
                break;
            case 'Number':
                if (hSettings.hProperties[sProp].bPrimary)
                    hSettings.sKeyProperty = sProp;
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
    }

    if (!hSettings.sKeyProperty)
        oSelf.warn('No bPrimary property set for '+sClass+'. At least one is required per class so it will not function properly.');

    // Add the required parameter section, for purposes of apiary.
    if (hSettings.sKeyProperty && hSettings.hApi) {
        if (!oSelf.hEndpointMap) oSelf.hEndpointMap = {};
        if (hSettings.hApi.hEndpoints) {
            for (var sEndpoint in hSettings.hApi.hEndpoints) {
                var aPaths = sEndpoint.split('/');
                (function buildMap(hMap,nIndex){
                    if (aPaths[nIndex+1]) {
                        if (!hMap[aPaths[nIndex]]) hMap[aPaths[nIndex]] = {};
                        buildMap(hMap[aPaths[nIndex]], (nIndex + 1));
                    } else if (!hMap[aPaths[nIndex]])
                        hMap[aPaths[nIndex]] = {'/':sClass};
                })(oSelf.hEndpointMap,1);

                // Find the param in curly braces. This is the required parameter in the api call.
                var aMatches = sEndpoint.match(/\{([^\}]*)\}/);
                if (aMatches) {
                    var sProp = aMatches[1];
                    if (!hSettings.hProperties[sProp])
                        oSelf.warn('API endpoint ('+sEndpoint+') has a required parameter defined ('+aMatches[0]+') that is not a property on the class.')
                    else {
                        if (!oSelf.hClasses[sClass].hApiParams) oSelf.hClasses[sClass].hApiParams = {};
                        oSelf.hClasses[sClass].hApiParams[sProp] = true;

                        hSettings.hApi.hEndpoints[sEndpoint].hParameters = {};
                        hSettings.hApi.hEndpoints[sEndpoint].hParameters[sProp] = {
                            bRequired:true
                            ,sType:hSettings.hProperties[sProp].sType||''
                            ,sDescription:hSettings.hProperties[sProp].sDescription||''
                            ,sExample:hSettings.hProperties[sProp].sSample||''
                        };
                    }
                }
            }
        }
    }
};

p.init = function (hOpts,fnCallback) {
    var oSelf = this;
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = null;
    }

    process.env.sViewPath = (hOpts && hOpts.sViewPath) ? hOpts.sViewPath : null;
    if (hOpts && (hOpts.NORDIS_ENV_ROOT_DIR || hOpts.NORDIS_ENV_CONF || hOpts.NORDIS_ENV_CONF_OVERRIDE))
        this.loadOptions(hOpts);

    if (process.env.sApp)
        oSelf.log('\nSTARTING: ' + process.env.sApp + oSelf.getEnvDescription(hOpts) +'\n------------###-------------');

    // Trap SIGINT for printout of debug stack traces and such.
    process.on('SIGINT', function() {
        oSelf.printTrace();
        process.exit();
    });

    if (fnCallback)
        fnCallback();
};

p.printTrace = function(){
    if (oSelf.hTrace) {
        console.log(oSelf.hTrace);
        for (var sId in oSelf.hTrace) {
            if (oSelf.hTrace[sId].hQuery && ((oSelf.hTrace[sId].Redis && !oSelf.hTrace[sId].Redis.bReleased) || (oSelf.hTrace[sId].MySql && !oSelf.hTrace[sId].MySql.bReleased))) {
                console.log('NOT RELEASED');
                console.log(oSelf.hTrace[sId]);
            } else if (oSelf.hTrace[sId].sSource == 'MySql') {
                console.log('NOT IN REDIS');
                console.log(oSelf.hTrace[sId]);
            }

        }
    }
}

p.silly = function (sMsg, bForce) {
    if (sMsg) {
        if (bForce)
            this.logger.debug(sMsg);
        else
            this.logger.silly(sMsg);
    }

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
    switch (nCode) {
        case 500:
            return 'Malformed request.';
        break;
        default:
            return 'Unhandled exception ('+nCode+'). No exception message provided.';
            break;
    }
};
/*
* This method can be used instead of process.exit when you need to do clean-up or wait for async processes
* to complete. It's up to you to implement this mechanism. This method is a vestige of an old, not-implemented-in-Nordis solution.
 */
p.exit = function () {
    process.exit();
};

/**
 * Used for debugging only, for storing info on the AppConfig singleton itself. This can be printed whenever, but
 * when sLogLevel = debug (or silly) then it gets printed on SIGINT by default.
 * @param key
 * @param value
 */
p.trace = function(key,value) {
    if (this.bTraceMode && key && value) {
        if (!this.hTrace) this.hTrace = {};
        if (value instanceof Object) {
            if (!this.hTrace[key]) this.hTrace[key] = {};
            if ((this.hTrace[key] instanceof Object))
                for (var sKey in value) {
                    this.hTrace[key][sKey] = value[sKey];
                }
            else
                this.error('Cannot set trace value on '+key+' because it has already been set and it isn\'t a hash.');
        } else
            this.hTrace[key] = value;
    }
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
    var sRedisConf = '\n REDIS: '+JSON.stringify(oSelf.hOptions.Redis);
    var sMySqlConf = (oSelf.hOptions.MySql.bSkip) ? '\n MYSQL: OFF' : '\n MYSQL: '+JSON.stringify(oSelf.hOptions.MySql);
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
/**
 * This method is for publishing events via Redis pub-sub. It is useful, for example, in updating in-memory processes that
 * need to update their copies of things when the data changes.
 * @param oObj
 * @param hMsg
 * @param fnCallback
 */
p.publish = function (txid, msg, fnCallback) {
    var oSelf = this;
    if (txid && msg) {
        oSelf.silly(txid+','+msg);
        oSelf.Redis.publish(txid, msg, fnCallback);
    }
};
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
p.trackStat = function(hOpts,fnCallback){
    var oSelf = this;
    var dDate = (hOpts && hOpts.dDate) ? moment(hOpts.dDate).utc() : moment.utc();
    var sStat = (hOpts && hOpts.sStat) ? hOpts.sStat : null;
    var Params = (hOpts && hOpts.Params) ? hOpts.Params : null;
    var oApp = (hOpts && hOpts.oApp) ? hOpts.oApp : null;

    var returnError = function(sErr) {
        if (sErr) {
            if (fnCallback)
                fnCallback(sErr);
            else
                oSelf.error(sErr);
        }
    };

    if (!sStat)
        returnError('Required property, sStat, not provided.');
    else if (!oSelf.hStats[sStat])
        returnError('Stat not configured: '+sStat);
    else if (!oSelf.hStats[sStat].fnValidate)
        returnError('fnValidate not defined for stat: '+sStat);
    else {
        async.waterfall([
            function(callback) {
                if (!oApp) {
                    var Base = require('./Base');
                    Base.loadAppSingleton('app',callback);
                } else
                    callback(null,oApp);
            }
            ,function(oApp,callback) {
                oSelf.hStats[sStat].fnValidate(Params, function (err, sKey) {
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
                                oSelf.Redis.hincrby(aKeys, sKey, hOpts.nFakeCount||1, callback, oSelf.hStats.sDbAlias);
                            else {
                                oSelf.Redis.incrby(aKeys, hOpts.nFakeCount||1, callback, oSelf.hStats.sDbAlias);
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
p.processStats = function(hOpts,fnCallback) {
    var oSelf = this;
    var async = require('async');
    var moment = require('moment');
    var Base = require('./Base');
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = {};
    }
    var oApp = (hOpts && hOpts.oApp) ? hOpts.oApp : null;

    if (hOpts && hOpts.nMin)
        hOpts.dStart = new Date(hOpts.nMin);
    if (hOpts && hOpts.nMax)
        hOpts.dEnd = new Date(hOpts.nMax);

    oSelf.info('Processing stats...');

    var aDbStats = [];
    var aRedisStats = [];

    async.series([
        function(callback) {
            if (!oApp) {
                var Base = require('./Base');
                Base.loadAppSingleton('app',function(err,oResult){
                    oApp = oResult;
                    callback();
                });
            } else
                callback();
        }
        // STEP ONE. The config tells us which kind of stat is which.  This method processes only redis stats.
        ,function(callback) {
            for (var sStat in oSelf.hStats) {
                if (oSelf.hStats[sStat].fnValidate)
                    aRedisStats.push(sStat);
                else if (oSelf.hStats[sStat].fnProcessQuery) // Mysql-based stats provide a query to retrieve the stat with a passed-in date range.
                    aDbStats.push(sStat);
            }
            callback();
        }
        // STEP TWO. Process redis-based stats. We could process db-based stats in parallel, but for readability this is done in series.
        ,function(callback) {
            if (!aRedisStats || !aRedisStats.length)
                callback();
            else
                async.forEach(aRedisStats,function(sStat,cb) {
                    async.waterfall([
                        // Step 1. We need to pull the key from Redis. This is not a fast query and so should be run at off hours
                        // or on a separate server altogether - and you could even query a backup Redis instance so as not to tax the
                        // primary redis box.
                        function(cback) {
                            oSelf.Redis.keys(oApp.getKey()+'-'+sStat+',*',cback,oSelf.hStats.sDbAlias);
                        }
                        // Step 2, loop through keys that are at or above the desired granularity.
                        ,function(aKeys,cback) {
                            if (!aKeys || !aKeys.length)
                                cback();
                            else
                                async.forEach(aKeys,function(sKey,cback2){
                                    // If the stat isn't a simple counter, look up the number of name-value pairs using the Redis HLEN command.
                                    // Otherwise, just use GET.
                                    async.waterfall([
                                        function(cback3){
                                            // Call the validate function without params. if it doesn't error out and returns empty key it's a simple count.
                                            oSelf.hStats[sStat].fnValidate(null,function(err){
                                                if (err) {
                                                    oSelf.Redis.hgetall(sKey,cback3,oSelf.hStats.sDbAlias);
                                                } else
                                                    oSelf.Redis.get(sKey,cback3,oSelf.hStats.sDbAlias);
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
                                                                oSelf.Redis.del(hOpts.sKey,cb,oStat.getSettings().sDbAlias);
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
                                                    if (oSelf.hStats[sStat].bFilters)
                                                        nCount += Number(res[sFilter]);
                                                    else
                                                        nCount++;
                                                }

                                                processRedisStat({
                                                    sKey:sKey
                                                    ,sGrain:sGrain
                                                    ,count:nCount
                                                    ,filters:(oSelf.hStats[sStat].bFilters) ? res : null
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
                                },cback);
                        }
                    ],cb);

                },callback);
        }
        // STEP THREE. Process mysql-based stats.
        ,function(callback) {
            if (aDbStats.length)
                async.forEach(aDbStats,function(sStat,cb){

                    var hSettings = oSelf.hStats[sStat];
                    var processMySqlStat = function(hOpts,cb2) {
                        async.parallel([
                            // Look up the related stat in the stats table.
                            function(cb3) {
                                var hQuery = {name:sStat,year:hOpts.year,month:hOpts.month,day:hOpts.day,hour:hOpts.hour};
                                if (oApp.getKey()) hQuery.app_id = oApp.getKey();

                                Base.lookup({sClass:'Stat',hQuery:hQuery},cb3);
                            }
                            // Look the stat up directly from the model data, using the fnProcessQuery from the stat configuration.
                            ,function(cb3) {
                                var Collection = require('./Collection');
                                // We're looking only in the timespan specified in processMySqlStat(hOpts), if any.
                                // Otherwise look in the parent hOpts;
                                var hSubOpts = {oApp:oApp}; // The oApp can help you filter by tenant, if you are serving multiple tenants with your stats.
                                if (hOpts.year) {
                                    var dStart = (hOpts.year) ? moment({year:hOpts.year,month:hOpts.month,day:hOpts.day,hour:hOpts.hour}).utc() : null;
                                    var dEnd = (hOpts.year) ? moment(dStart).add('hours',1) : null;
                                    hSubOpts.dStart = dStart.toDate();
                                    hSubOpts.nMin = dStart.valueOf();
                                    hSubOpts.dEnd = dEnd.toDate();
                                    hSubOpts.nMax = dEnd.valueOf();
                                }
                                new Collection({sClass:hSettings.sClass,sSource:'MySql',nSize:1,hQuery:hSettings.fnProcessQuery(hSubOpts,oSelf)},cb3);
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

                                if (hOpts.year)
                                    oStat.set('date',moment(hOpts).utc().valueOf())

                                oStat.save(cb2);
                            }
                        });
                    };

                    // If a date range is passed in via hOpts, then we'll process day, hour, month, etc. Otherwise, we'll do only 'all' time stat.
                    if (hOpts && hOpts.dStart && hOpts.dEnd) {
                        // process each hour between dStart and dEnd;
                        var moment = require('moment');
                        var dNow = moment(hOpts.dStart).utc();
                        var dEnd = moment(hOpts.dEnd).utc();
                        // And do one for the 'all' count:
                        var aIncrements = [{year:null,month:null,hour:null,day:null}];
                        // And add one for each unique day, month and year;
                        var nDay;
                        var nMonth;
                        var nYear;
                        while (dNow < dEnd) {
                            if (nDay != dNow.date()) {
                                nDay = dNow.date();
                                aIncrements.push({year: dNow.year(), month: dNow.month(), day: dNow.date(), hour: null});
                            }
                            if (nMonth != dNow.month()) {
                                nMonth = dNow.month();
                                aIncrements.push({year: dNow.year(), month: dNow.month(), day: null, hour: null});
                            }
                            if (nYear != dNow.year()){
                                nYear = dNow.year();
                                aIncrements.push({year: dNow.year(), month: null, day: null, hour: null});
                            }
                            aIncrements.push({year:dNow.year(),month:dNow.month(),hour:dNow.hour(),day:dNow.date()});
                            dNow.add('hour',1);
                        }
                        async.forEach(aIncrements,processMySqlStat,cb);

                    } else
                        processMySqlStat({year:null,day:null,month:null,hour:null},cb);

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
p.flushStats = function(hOpts,fnCallback){
    var oSelf = this;
    var async = require('async');
    var Base = require('./Base');
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts= {};
    }

    // Create a collection of 'App' objects for which to remove stats. If the oApp option is passed in
    // then that's all we touch. Otherwise we get 'em all.
    var Collection = require('./Collection');
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
                                async.forEach(['hour', 'day', 'month', 'year', 'alltime'],function(sGrain,cb4){
                                    if (oApp[sExtra] && oApp[sExtra][sGrain] && oApp[sExtra][sGrain].nTotal) {
                                        console.log('DELETE '+sExtra+'.'+sGrain+': '+oApp[sExtra][sGrain].nTotal);
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
                var hTopLevel = {};

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
                            fs.appendFileSync(sPath,'# '+(oSelf.hApi.sTitle||'')+'\n');
                        // And the description for the api.
                        if (oSelf.hApi && oSelf.hApi.sDescription)
                            fs.appendFileSync(sPath,(oSelf.hApi.sDescription||'')+'\n\n');
                        callback();
                    }
                    // Copy top-level endpoints into their respective classes. This allows for path names that don't follow
                    // a class-based semantic.
                    ,function(callback) {
                        if (oSelf.hApi && oSelf.hApi.hEndpoints)
                            for (var sEndpoint in oSelf.hApi.hEndpoints) {
                                var sClass = oSelf.hApi.hEndpoints[sEndpoint].sClass;
                                if (sClass) {
                                    if (!oSelf.hClasses[sClass].hApi) oSelf.hClasses[sClass].hApi = {};
                                    oSelf.hClasses[sClass].hApi[sEndpoint] = oSelf.hApi.hEndpoints[sEndpoint];
                                } else
                                    oSelf.warn('Endpoint ('+sEndpoint+') is not associated with a class, and therefore will not be documented in the apiary.apib file.');
                            }
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

                            // Write class-level details.
                            fs.appendFileSync(sPath,'# Group '+sClass+'\n');
                            if (oSelf.hClasses[sClass].hApi.sDescription)
                                fs.appendFileSync(sPath,(oSelf.hClasses[sClass].hApi.sDescription||'')+'\n\n');

                            var aEndpoints = [];
                            // Create entries for each endpoint/path.
                            for (var sEndpoint in oSelf.hClasses[sClass].hApi.hEndpoints) {
                                aEndpoints.push(sEndpoint);
                            }

                            if (aEndpoints.length)
                                async.forEach(aEndpoints,function(sEndpoint,cb) {
                                    console.log(sClass+': '+sEndpoint);

                                    fs.appendFileSync(sPath,'## '+sClass+' ['+sEndpoint+']\n');
                                    fs.appendFileSync(sPath,(oSelf.hClasses[sClass].hApi.hEndpoints[sEndpoint].sDescription||'')+'\n\n');

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