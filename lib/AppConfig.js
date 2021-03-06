var winston = require('winston'),
    moment  = require('moment-timezone'),
    events  = require('events'),
    util    = require('util'),
    fs      = require('fs');

function AppConfig(hOpts) {
    this.loadOptions(hOpts);
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
    process.env.NORDIS_ENV_ROOT_DIR = oSelf.NORDIS_ENV_ROOT_DIR;
    // Pass in options or set in environment (NORDIS_ENV_CONF) the file location of root configuration file.
    oSelf.NORDIS_ENV_CONF = (hOpts && hOpts.NORDIS_ENV_CONF) ? hOpts.NORDIS_ENV_CONF : (process.env.NORDIS_ENV_CONF) ? process.env.NORDIS_ENV_CONF : null;
    process.env.NORDIS_ENV_CONF = oSelf.NORDIS_ENV_CONF;
    // Pass in options or set in environment (NORDIS_ENV_CONF_OVERRIDE) the file location of environment-specific override file (optional).
    oSelf.NORDIS_ENV_CONF_OVERRIDE = (hOpts && hOpts.NORDIS_ENV_CONF_OVERRIDE) ? hOpts.NORDIS_ENV_CONF_OVERRIDE : process.env.NORDIS_ENV_CONF_OVERRIDE;
    process.env.NORDIS_ENV_CONF_OVERRIDE = oSelf.NORDIS_ENV_CONF_OVERRIDE;

    if (!oSelf.NORDIS_ENV_ROOT_DIR || !fs.existsSync(oSelf.NORDIS_ENV_ROOT_DIR)) {
        oSelf.NORDIS_ENV_ROOT_DIR = './../';
    }
    if (!oSelf.NORDIS_ENV_CONF || !fs.existsSync(oSelf.NORDIS_ENV_CONF)) {
        oSelf.NORDIS_ENV_CONF = './../examples/conf.js';
    }

    try {
        var hConf = require(oSelf.NORDIS_ENV_CONF);
        hConf = hConf.hSettings;
        // In case init is run more than once, or override is done via hOpts - delete any previous settings.
        delete oSelf.hClasses; delete oSelf.hStats; delete oSelf.hOptions; delete oSelf.hApi; delete oSelf.hEndpointMap; delete oSelf.hMetrics;
        // config root should be 'global'
        for (var sProp in hConf.global) {
            oSelf[sProp] = hConf.global[sProp];
        }
        // Look for section matching the NORDIS_ENV and use it to override global defaults.
        if (oSelf.NORDIS_ENV && hConf[oSelf.NORDIS_ENV]) {
            _appendHash(oSelf,hConf[oSelf.NORDIS_ENV]);
        }
    } catch (err) {

    }

    // Check for an environment-specific override .conf file. This is where we change whatever
    // we need to for the environment.
    if (oSelf.NORDIS_ENV_CONF_OVERRIDE && fs.existsSync(oSelf.NORDIS_ENV_CONF_OVERRIDE)) {
        try {
            var hEnvConf = require(oSelf.NORDIS_ENV_CONF_OVERRIDE);
            _appendHash(oSelf,hEnvConf.hSettings.global);
            // Again, look for section matching the NORDIS_ENV and use it to override global defaults.
            // This overrides the overrides above (in the default file).
            if (oSelf.NORDIS_ENV && hEnvConf.hSettings[oSelf.NORDIS_ENV]) {
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

    oSelf.hClassMap = {};
    oSelf.hEndpointMap = {};
    oSelf.hEndpointKeywords = {};
    oSelf.hExtrasByClass = {};
    var hPrimaries = {};
    var bBuildMySql = (hOpts && hOpts.bBuildMySql) ? true : false;

    for (var sClass in oSelf.hClasses) {
        // Reset auto-gen classes and stats.
        if (!oSelf.hClasses[sClass].nClass)
            delete oSelf.hClasses[sClass]
        else
            oSelf.processClass(sClass,bBuildMySql);

        if (oSelf.hClasses[sClass] && oSelf.hClasses[sClass].sKeyProperty)
            hPrimaries[oSelf.hClasses[sClass].sKeyProperty] = (hPrimaries[oSelf.hClasses[sClass].sKeyProperty]) ? hPrimaries[oSelf.hClasses[sClass].sKeyProperty]+1 : 1;

        if (oSelf.hClasses[sClass] && oSelf.hClasses[sClass].hExtras){
            for (var sExtra in oSelf.hClasses[sClass].hExtras) {
                var sExtraClass = oSelf.hClasses[sClass].hExtras[sExtra].sClass;
                if (sExtraClass && oSelf.hClasses[sClass].hExtras[sExtra].fnCreate) {
                    if (!oSelf.hExtrasByClass[sExtraClass]) oSelf.hExtrasByClass[sExtraClass] = [];
                    oSelf.hExtrasByClass[sExtraClass].push({sParent:sClass,sExtra:sExtra});
                }
            }
        }
    }

    var n = 0;
    for (var sClass in hPrimaries){
        if (hPrimaries[sClass] > n)
            oSelf.sMostCommonPrimaryKey = sClass;
    }

    // Build top-level api calls into the endpoint map.
    if (oSelf.hApi && oSelf.hApi.hEndpoints) {
        oSelf.hEndpointMap = {};
        for (var sEndpoint in oSelf.hApi.hEndpoints) {
            var sClass = oSelf.hApi.hEndpoints[sEndpoint].sClass;
            var aPaths = sEndpoint.split('/');
            if (!oSelf.hEndpointKeywords[aPaths[1]]) oSelf.hEndpointKeywords[aPaths[1]] = [];
            oSelf.hEndpointKeywords[aPaths[1]].push({sRegEx:sEndpoint.replace(/\{[^\}]*\}/,'([^\/]*)'),sEndpoint:sEndpoint,sClass:sClass});
        }
    }

    // The Stat class must be defined in order to store scrubbed data in a way that can be retrieved via the framework.
    if (oSelf.hClasses.Metric)
        throw new Error('\'Metric\' is a protected class name in Nordis for purposes of storing usage stats and analytics. Please choose another class name.');
    else {
        oSelf.hClasses.Metric = {
            sDbAlias:(oSelf.hMetrics && oSelf.hMetrics.sDbAlias) ? oSelf.hMetrics.sDbAlias : 'default'
            ,sSource:'MySql'
            ,hProperties:{
                nID:{bPrimary:true,sType:'Number'}
                ,sName:{sType:'String',sMySqlType:'CHAR(40)',bIndex:true}
                ,sFilter:{sType:'String',sMySqlType:'CHAR(64)',bIndex:true}
                ,nCount:{sType:'Number'}
                ,date:{sType:'Timestamp'}
                ,year:{sType:'Number'}
                ,month:{sType:'Number'}
                ,day:{sType:'Number'}
                ,hour:{sType:'Number'}
                ,sMeta:{sType:'String'}
            }
        };
        oSelf.processClass('Metric',bBuildMySql);
    }

    // Build top-level Metrics into the endpoint map.
    if (oSelf.hMetrics) {
        for (var sMetric in oSelf.hMetrics) {
            if (oSelf.hMetrics[sMetric].sAlias) {
                oSelf.hEndpointKeywords['metric'].push({bMetric:true,sName:sMetric,sEndpoint:'/metric/'+oSelf.hMetrics[sMetric].sAlias.toLowerCase()});
            }
        }
    }
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

p.processClass = function(sClass,bBuildMySql) {
    var oSelf = this;
    var hSettings = oSelf.hClasses[sClass];

    if (hSettings.nClass) oSelf.hClassMap[hSettings.nClass] = sClass;
    if (hSettings.sClassAlias) oSelf.hClassMap[hSettings.sClassAlias.toLowerCase()] = sClass;
    oSelf.hClassMap[sClass.toLowerCase()] = sClass;

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
                if (hSettings.hProperties[sProp].bUnique) {
                    hSettings.aSecondaryLookupKeys.push(sProp);
                } else if (hSettings.hProperties[sProp].bPrimary)
                    hSettings.sKeyProperty = sProp;
                if (hSettings.hProperties[sProp].nLength && (hSettings.hProperties[sProp].bUnique || hSettings.hProperties[sProp].bPrimary))
                    hSettings.sStrKeyProperty = sProp;
                break;
            case 'Number':
                if (hSettings.hProperties[sProp].bPrimary)
                    hSettings.sKeyProperty = sProp;
                else if (hSettings.hProperties[sProp].bUnique)
                    hSettings.aSecondaryLookupKeys.push(sProp);
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
    if (hSettings.sKeyProperty) {
        if (hSettings.hApi && hSettings.hApi.hEndpoints) {
            for (var sEndpoint in hSettings.hApi.hEndpoints) {
                var aPaths = sEndpoint.split('/');
                if (!oSelf.hEndpointKeywords[aPaths[1]]) oSelf.hEndpointKeywords[aPaths[1]] = [];
                // The class attached to the match is the context of the call.
                var hMatch = {sRegEx:sEndpoint.replace(/\{[^\}]*\}/,'([^\/]*)'),sEndpoint:sEndpoint,sClass:sClass};

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
                        hMatch.sLookupProperty = sProp;
                    }
                }
                oSelf.hEndpointKeywords[aPaths[1]].push(hMatch);
            }
        }
        // Create endpoints for any Metric in the class' configuration that has an 'sAlias' which means it should be exposed via
        // an endpoint that follows this pattern: /metric/{{sClass}}/{{sAlias}}
        if (hSettings.hMetrics) {
            if (!oSelf.hEndpointMap) oSelf.hEndpointMap = {};
            if (!oSelf.hEndpointKeywords['metric']) oSelf.hEndpointKeywords['metric'] = [];
            oSelf.hEndpointKeywords['metric'].push({bMetric:true,sEndpoint:'/metric/'+sClass.toLowerCase(),sClass:sClass});
        }
    }
    if (bBuildMySql) {
        var Base = require('./Base');
        oSelf.MySql.acquire(function(err,oClient){
            if (!err && oClient) {
                var oObj = Base.lookup({sClass:sClass});
                oSelf.MySql.confirmTable(oClient,oObj,function(err){
                    console.error(err);
                });
            }
        },hSettings.sDbAlias);
    }
};

p.init = function (hOpts,fnCallback) {
    var oSelf = this;
    if (hOpts instanceof Function) {
        fnCallback = hOpts;
        hOpts = null;
    }

    process.env.sViewPath = (hOpts && hOpts.sViewPath) ? hOpts.sViewPath : null;
    if (hOpts && (hOpts.NORDIS_ENV_ROOT_DIR || hOpts.NORDIS_ENV_CONF || hOpts.NORDIS_ENV_CONF_OVERRIDE || hOpts.bBuildMySql))
        oSelf.loadOptions(hOpts);

    if (process.env.sApp && !hOpts.bSkipStartLog)
        oSelf.log('\nSTARTING: ' + (process.env.sApp||'') + oSelf.getEnvDescription(hOpts) +'\n------------###-------------');

    if (oSelf.fnInit)
        oSelf.fnInit();

    if (fnCallback)
        fnCallback();
};

p.setLogLevel = function(sLevel) {
    var oSelf = this;
    if (sLevel) oSelf.sLogLevel = sLevel;
    oSelf.logger.level = oSelf.sLogLevel;
    for (var sTransport in oSelf.logger.transports) {
        oSelf.logger.transports[sTransport].level = oSelf.sLogLevel;
    }
    //console.log('Log level set to '+oSelf.sLogLevel);
};

p.silly = function (sMsg, bForce) {
    var oSelf = this;
    if (sMsg) {
        if (bForce)
            oSelf.logger.debug(sMsg);
        else
            oSelf.logger.silly(sMsg);
    }

};

p.verbose = function (sMsg, oObj) {
    var oSelf = this;
    if (sMsg)
        oSelf.logger.verbose(sMsg, (oObj||null));
};

p.debug = function (sMsg, oObj) {
    var oSelf = this;
    oSelf.logger.debug(sMsg, (oObj||null));
};

p.info = function (sMsg, oObj) {
    var oSelf = this;
    if (sMsg)
        oSelf.logger.info(sMsg, (oObj||null));
};

p.warn = function (sMsg, oObj) {
    var oSelf = this;
    if (sMsg)
        oSelf.logger.warn(sMsg, (oObj||null));
};

p.error = function (err) {
    var oSelf = this;
    if (err) {
        var stack = (err && err.stack) ? err.stack : new Error().stack;
        var sErr='';
        try {
            if (err instanceof Object) {
                for (var s in err) {
                    if (err[s]) {
                        if (err[s] instanceof Object) {
                            for (var k in err[s]) {
                                if ((err[s][k] instanceof Object)===false)
                                    sErr += +'--'+err[s][k] + '\n';
                            }
                        } else
                            sErr += err[s] + '\n';
                    }
                }
            } else
                sErr = err.toString();

        } catch (er) {
            console.error(err);
        }
        oSelf.logger.error(sErr,stack);
    }
};
/**
 * Logs error, tries to grab a stack trace, and emits an 'onFatalError' event if you want
 * to notify someone regarding the error.
 * @param err
 * @param oObj
 */
p.fatal = function (err, bExit, bIgnoreStack) {
    var oSelf = this;
    var stack = (bIgnoreStack) ? '' : (err && err.stack) ? err.stack : new Error().stack;
    var sErr='';
    try {
        (function stringifyWithLineBreaks(o,n){
            if (typeof o == 'object') {
                for (var s in o)  stringifyWithLineBreaks(o[s],s);
            } else
                sErr += (n||'')+': '+o.toString()+'<br/>';

        })(err);

    } catch (er) {
        sErr = err.toString().toString();
        console.error(err);
    }

    oSelf.logger.error('FATAL: ' + sErr,stack);
    if (oSelf.fnFatalErrorHandler) {
        oSelf.fnFatalErrorHandler(sErr,stack,oSelf,function(){
            if (bExit) process.exit();
        });
    } else if (bExit)
        process.exit();

};
/**
 * Replacement for console.log. Adds line break and serializes the oObj param, if passed in.
 * @param sMsg
 * @param oObj
 */
p.log = function(sMsg,oObj) {
    console.log(sMsg,oObj);
};

p.wrapTest = function(err,test) {
    if (err)
        this.fatal(err);
    test.done();
};

p.handleTestError = function(err) {
    p.error(err);
    throw err;
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
    var oSelf = this;
    oSelf.MySql.end(function(){
        process.exit();
    });
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
    var sPort = (process.env.PORT) ? '\nPORT: '+process.env.PORT : (oSelf.hAppSettings && oSelf.hAppSettings[process.env.sApp] && oSelf.hAppSettings[process.env.sApp].nPort) ? '\n PORT: ' + oSelf.hAppSettings[process.env.sApp].nPort : '';
    var sViews = (oSelf.sViewPath && oSelf.sViewPath.match(/\//)) ? '\n VIEW DIR: '+oSelf.sViewPath : '';
    var sWorkerId = (hOpts && hOpts.sWorkerId) ? '\n PROCESS ID: '+hOpts.sWorkerId : '';
    var sLogLevel = '\n LOG LEVEL: '+oSelf.sLogLevel;

    var sNordis = '';
    if (fs.existsSync(oSelf.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json')) {
        var hNordisInstance = require(oSelf.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json');
        sNordis = '\n NORDIS VERSION: '+hNordisInstance.version;
    }
    var sApp = '';
    if (fs.existsSync(oSelf.NORDIS_ENV_ROOT_DIR+'/package.json')) {
        var hAppInstance = require(oSelf.NORDIS_ENV_ROOT_DIR+'/package.json');
        sApp = '\n APP VERSION: '+hAppInstance.version;
    }
    var sEnv = '\n NORDIS_ENV: ' + oSelf.NORDIS_ENV+'\n NORDIS_ENV_ROOT_DIR: ' + oSelf.NORDIS_ENV_ROOT_DIR+'\n NORDIS_ENV_CONF: ' + oSelf.NORDIS_ENV_CONF;
    if (oSelf.NORDIS_ENV_CONF_OVERRIDE)
        sEnv += '\n NORDIS_ENV_CONF_OVERRIDE: '+oSelf.NORDIS_ENV_CONF_OVERRIDE;

    return sEnv+sApp+sNordis+sPort+sViews+sWorkerId+sLogLevel;
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
        oSelf.broadcast(txid, msg, fnCallback);
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
                        if (!oSelf.hClassMap)
                            oSelf.init(null,callback);
                        else
                            callback();
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
                        async.forEachOf(aClasses,function(sClass,ind,cback){

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
                                async.forEachOf(aEndpoints,function(sEndpoint,ind,cb) {

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

p.getClasses = function(sClass) {
    var oSelf = this;
    if (sClass)
        return oSelf.hClasses[sClass];
    else
        return oSelf.hClasses;
};

p.getClassMap = function(sClass) {
    var oSelf = this;
    if (sClass)
        return oSelf.hClassMap[sClass];
    else
        return oSelf.hClassMap;
}

p.getEnv = function(sEnv) {
    var oSelf = this;
    return oSelf[sEnv];
};

p.get = function(sProperty) {
    var oSelf = this;
    return oSelf[sProperty];
};

p.set = function(sProperty,Value) {
    var oSelf = this;
    return oSelf[sProperty] = Value;
};

p.getOpts = function(sClass,sProperty,sName) {
    var oSelf = this;
    if (oSelf.hClasses[sClass] && oSelf.hClasses[sClass].hProperties[sProperty] && oSelf.hClasses[sClass].hProperties[sProperty].hOptions) {
        if (sName)
            return oSelf.hClasses[sClass].hProperties[sProperty].hOptions[sName]
        else
            return oSelf.hClasses[sClass].hProperties[sProperty].hOptions
    }
};

p.broadcast = function(txid,message,fnCallback) {
    var oSelf = this;
    if (txid) {
        if (message instanceof Object) message = JSON.stringify(message);
        oSelf.Redis.publish(txid,message,function(err){
            if (err)
                oSelf.fatal(err);
            else if (fnCallback)
                fnCallback();
        });
    }
};

p.subscribe = function(txid,messageHandler,fnCallback) {
    var oSelf = this;
    var subscribe = function() {
        oSelf.debug('SUBSCRIBE TO '+oSelf.dbSub.sHashKey+txid);
        oSelf.dbSub.unsubscribe(oSelf.dbSub.sHashKey+txid);
        oSelf.dbSub.subscribe(oSelf.dbSub.sHashKey+txid);
        if (messageHandler) {
            oSelf.dbSub.removeListener('message',messageHandler);
            oSelf.dbSub.addListener('message',messageHandler);
        }
        if (fnCallback) fnCallback();
    };
    if (!oSelf.dbSub) {
        oSelf.Redis.acquireSub(function(err,oClient){
            if (err)
                oSelf.fatal(err);
            else {
                oSelf.dbSub = oClient;
                subscribe();
            }
        });
    } else
        subscribe();
};

p.unsubscribe = function(txid,messageHandler) {
    var oSelf = this;
    var unsubscribe = function() {
        //oSelf.debug('UNSUBSCRIBE FROM '+txid);
        oSelf.dbSub.unsubscribe(txid);
        if (messageHandler) oSelf.dbSub.removeListener('message',messageHandler);
    };
    if (!oSelf.dbSub)
        oSelf.Redis.acquireSub(function(err,oClient){
            if (err)
                oSelf.fatal(err);
            else {
                oSelf.dbSub = oClient;
                unsubscribe();
            }
        });
    else
        unsubscribe();
};

var oSelf = new AppConfig();

module.exports = oSelf;