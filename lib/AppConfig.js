var winston = require('winston'),
    events  = require('events'),
    util = require('util'),
    fs = require('fs');

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
    // Convenience logging methods. Just require AppConfig class in your file and call App.info, App.debug, App.error etc.
    oSelf.logger = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({ level:'warn' })
        ]
    });
    oSelf.logger.level = oSelf.sLogLevel||'warn';

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
        oSelf.NORDIS_ENV_CONF = './../example/conf.js';
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
    oSelf.debug('----- APP CONFIG -----');
    for (var sClass in oSelf.hClasses) {
        oSelf.debug('----- '+sClass+' -----');
        oSelf.debug(oSelf.hClasses[sClass]);
    }
    oSelf.debug('----- END APP CONFIG -----');
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

    if (!hSettings.nClass) {
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
    for (var sProp in hSettings.hProperties) {
        hSettings.aProperties.push(sProp);
        switch (hSettings.hProperties[sProp].sType) {
            case 'String':
                if (hSettings.hProperties[sProp].bUnique) {
                    hSettings.aSecondaryLookupKeys.push(sProp);
                    if (hSettings.hProperties[sProp].nLength)
                        hSettings.sStrKeyProperty = sProp;
                }
                break;
            case 'Number':
                if (hSettings.hProperties[sProp].bUnique)
                    hSettings.sNumKeyProperty = sProp;
                break;
            case 'Timestamp':
                if (hSettings.hProperties[sProp].bOnCreate)
                    hSettings.hProperties[sProp].sCreateTimeProperty = sProp;
                else if (hSettings.hProperties[sProp].bOnUpdate)
                    hSettings.hProperties[sProp].sUpdateTimeProperty = sProp;
                break;
        }
    }

    if (!hSettings.sNumKeyProperty)
        throw new Error('sNumKeyProperty property not set for '+sClass+'. This is required so we cannot continue.');
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
    var oSelf = this;
    if (sMsg || oObj) {
        if (!oObj)
            oObj = {sMsg:sMsg};
        else if (oObj.sMessage)
            sMsg = oObj.sMessage;

        sMsg = (sMsg) ? sMsg.toString() : '';
        this.logger.error(sMsg.toString(), (oObj||null));
    }
};

p.fatal = function (sMsg, oObj) {
    if (!oObj && sMsg) {
        if (sMsg.toString() == '[object Object]')
            oObj = sMsg;
        else
            oObj = {sMsg:sMsg};
    }
    oObj = {stack:new Error().stack, oObj:oObj, sMsg:JSON.stringify(sMsg)};
    this.logger.error('FATAL: ' + sMsg.toString(), oObj);
    this.emit('onFatalError',{sMsg:sMsg,oObj:oObj});
};

p.log = function(sMsg,oObj) {
    if (sMsg)
        console.log('\n'+sMsg);
    if (oObj) {
        console.log('\n');
        console.log(oObj);
    }
};

/**
 * This method publishes both to the console and to the status key in redis for
 * publication/subscription (i.e. displays on the status.html website).
 *
 * @param sMsg
 * @param oData
 * @param sHtml
 */
p.status = function (sMsg, oData, sHtml) {
    if (sMsg)
        this.logger.info((process.env.sApp||'')+': '+(sMsg||''));
};

p.wrapTest = function(err,test) {
    if (err)
        this.fatal(err);
    test.done();
};

p.getError = function(nCode) {
    if (this.hErrorStrings && this.hErrorStrings[nCode])
        return this.hErrorStrings[nCode][this.sLanguage||'en'];
    else
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
    var sMySqlConf = '\n MYSQL: '+oSelf.hOptions.MySql.sHost+':'+oSelf.hOptions.MySql.sSchema;
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
    var sID = oObj.nClass+':'+(oObj.getStrKey()||oObj.getNumKey());
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
                App.warn(err);
        }
    }

    if (hMsg && hMsg.sLog)
        this.info(hMsg.sLog);
    if (oObj.nClass == App.nClass_Consumer) {
        if (!hMsg.sLog && !hMsg.sProcess)
            sID = oObj.nClass+':'+oObj.get('sToken');
    }
    if (oObj && oObj.txid)
        sID = oObj.txid;

    if (sID && sData) {
        oSelf.Redis.publish(sID, sData, function () {
            if (fnCallback)
                fnCallback();
        });
    }
};

var oSelf = new AppConfig();

module.exports = oSelf;