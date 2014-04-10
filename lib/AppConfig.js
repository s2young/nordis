var winston = require('winston'),
    moment  = require('moment'),
    events  = require('events'),
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
    oSelf.setLogLevel(oSelf.sLogLevel||'warn');


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
        oSelf.setLogLevel(oSelf.sLogLevel);
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
                ,updated:{sType:'Timestamp',bOnUpdate:true}
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
                        ,updated:{sType:'Timestamp',bOnUpdate:true}
                    }
                    ,hExtras: {}
                };

                // Add extras for each granularity.
                var aGrains = oSelf.hStats[sStat].aGrains || ['hour', 'day', 'month', 'year', 'alltime'];
                aGrains.forEach(function (sGrain) {
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

p.setLogLevel = function(sLevel) {
    var oSelf = this;
    if (sLevel) oSelf.sLogLevel = sLevel;
    oSelf.logger.level = oSelf.sLogLevel;
    for (var sTransport in oSelf.logger.transports) {
        oSelf.logger.transports[sTransport].level = oSelf.sLogLevel;
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