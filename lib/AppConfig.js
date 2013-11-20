var winston = require('winston'),
    fs = require('fs');

/**
 * In order to run properly, the environment needs to be configured with the following:
 *
 * NORDIS_ENV - This string is used in allowing environment-specific configuration. The conf file
 * contains top-level keys named for specific environments with 'global' being the defaults for all
 * environments. This way, one can configure an environment with appropriate connection settings, IP
 * addresses, etc.
 *
 * NORDIS_ENV_ROOT_DIR - This is the root directory under which all library code is stored. This allows
 * easy porting between servers and environments, and even having multiple environments on a single
 * machine, running in different directories.
 *
 * NORDIS_ENV_CONF - The full path for the base config file.
 *
 * NORDIS_ENV_CONF_OVERRIDE - The full path for an environment-specifc config file (for dev, staging, localhost).
  */
function AppConfig() {
    this.loadOptions({
        sRootClassPath:process.env.NORDIS_ENV_ROOT_DIR+'/lib/'
        ,sConfigFilePath:process.env.NORDIS_ENV_CONF
        ,sEnvironmentConfigFilePath:process.env.NORDIS_ENV_CONF_OVERRIDE
    });
}

var p = AppConfig.prototype;
p.hConsumers = {};
p.hEventHandlers = {};

p.loadOptions = function(hOpts) {
    var oSelf = this;
    oSelf.sRootClassPath = hOpts.sRootClassPath;
    if (!oSelf.hOptions) {
        var hConf = require(hOpts.sConfigFilePath).hSettings;
        for (var sProp in hConf.global) {
            oSelf[sProp] = hConf.global[sProp];
        }
        // Look for section matching the NORDIS_ENV and use it to override global defaults.
        if (hConf[process.env.NORDIS_ENV]) {
            _appendHash(oSelf,hConf[process.env.NORDIS_ENV]);
        }
    }

    // Check for an environment-specific override .conf file. This is where we change whatever
    // we need to for the environment.
    if (hOpts && hOpts.sEnvironmentConfigFilePath) {
        try {
            var hEnvConf = require(hOpts.sEnvironmentConfigFilePath);
            _appendHash(oSelf,hEnvConf.hSettings.global);
            // Again, look for section matching the NORDIS_ENV and use it to override global defaults.
            // This overrides the overrides above (in the default file).
            _appendHash(oSelf,hEnvConf.hSettings[process.env.NORDIS_ENV]);
        } catch (err) {
            oSelf.info('No environment override file found. Using default settings instead. We looked here: '+hOpts.sEnvironmentConfigFilePath,err);
        }
    }

    // Singleton instances of Redis class. Redis connections are managed in a pool
    oSelf.Redis = require('./Utils/Data/Redis');
    oSelf.Redis.init(oSelf.hOptions.Redis);

    oSelf.MySql = require('./Utils/Data/MySql');
    oSelf.MySql.init(oSelf.hOptions.MySql);

    // Define default data source.
    oSelf.sDefaultDb = (oSelf.hConstants && oSelf.hConstants.sDefaultDb) ? oSelf.hConstants.sDefaultDb : 'MySql';

    // Convenience logging methods. Just require oSelf class in your file and call App.info, App.debug, App.error etc.
    oSelf.logger = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({ level: oSelf.sLogLevel||'error' })
        ]
    });

    // Dynamically update class aProperties with all the image types and sizes.

    if (!oSelf.hClassMap) oSelf.hClassMap = {};
    for (var sClass in oSelf.hClasses) {
        var aDynamicProps = [];
        if (oSelf.hClasses[sClass].hImages) {
            for (var sType in oSelf.hClasses[sClass].hImages) {
                aDynamicProps.push('s'+sType);
                for (var i = 0; i < oSelf.hClasses[sClass].hImages[sType].aSizes.length; i++) {
                    aDynamicProps.push('s'+sType+oSelf.hClasses[sClass].hImages[sType].aSizes[i].nSize);
                }
            }
            oSelf.hClasses[sClass].aImages = aImages;
        }
        oSelf.hClasses[sClass].aProperties = oSelf.hClasses[sClass].aProperties.concat(aDynamicProps);

        if (!oSelf.hClasses[sClass].nClass) {
            throw new Error('Class improperly configured. Missing nClass value for '+sClass);
        } else {
            oSelf.hClassMap[oSelf.hClasses[sClass].nClass] = sClass;
            oSelf.hClassMap[sClass.toLowerCase()] = sClass;
        }

        if (!oSelf.hClasses[sClass].hProperties)
            oSelf.hClasses[sClass].hProperties = {};
        oSelf.hClasses[sClass].aProperties.forEach(function(sProp,n){
            switch (sProp.substring(0,1)) {
                case 'n':
                    oSelf.hClasses[sClass].hProperties[sProp] = 'Number';
                    break;
                case 'b':
                    oSelf.hClasses[sClass].hProperties[sProp] = 'Boolean';
                    break;
                case 's':
                    oSelf.hClasses[sClass].hProperties[sProp] = 'String';
                    break;
                default:
                    throw new Error(sProp+' on '+sClass+' does not follow hungarian notation so we do not know what it is. You will need to define an hProperties section for each class.');
                    oSelf.hClasses[sClass].hProperties[sProp] = '';
                    break;
            }
        });
        if (oSelf.hClasses[sClass].sNumericKey && !oSelf.hClasses[sClass].hProperties[oSelf.hClasses[sClass].sNumericKey]) {
            oSelf.hClasses[sClass].aProperties = oSelf.hClasses[sClass].aProperties.concat([oSelf.hClasses[sClass].sNumericKey]);
            oSelf.hClasses[sClass].hProperties[oSelf.hClasses[sClass].sNumericKey] = 'Number';
        } else if (!oSelf.hClasses[sClass].sNumericKey)
            throw new Error('sNumericKey property not set for '+sClass+'. This is required so we cannot continue.');

        if (oSelf.hClasses[sClass].sStringKey && !oSelf.hClasses[sClass].hProperties[oSelf.hClasses[sClass].sStringKey]) {
            oSelf.hClasses[sClass].aProperties = oSelf.hClasses[sClass].aProperties.concat([oSelf.hClasses[sClass].sStringKey]);
            oSelf.hClasses[sClass].hProperties[oSelf.hClasses[sClass].sStringKey] = 'String';
        }
        // We always add nCreated & nUpdated fields.
        if (!oSelf.hClasses[sClass].hProperties.nCreated) {
            oSelf.hClasses[sClass].aProperties = oSelf.hClasses[sClass].aProperties.concat(['nCreated']);
            oSelf.hClasses[sClass].hProperties.nCreated = 'Number';
        }
        if (!oSelf.hClasses[sClass].hProperties.nUpdated) {
            oSelf.hClasses[sClass].aProperties = oSelf.hClasses[sClass].aProperties.concat(['nUpdated']);
            oSelf.hClasses[sClass].hProperties.nUpdated = 'Number';
        }
    }
    oSelf.debug('----- APP CLASS MAP -----');
    oSelf.debug(oSelf.hClassMap);
    oSelf.debug('----- END APP CLASS MAP -----');
};

var _appendHash = function (hExisting, hNew) {
    for (var sKey in hNew) {
        if (hExisting[sKey] && hExisting[sKey].toString() == '[object Object]') {
            _appendHash(hExisting[sKey], hNew[sKey]);
        } else {
            hExisting[sKey] = hNew[sKey];
        }
    }
};

p.init = function (hOpts,fnCallback) {
    var oSelf = this;
    process.env.sViewPath = (hOpts && hOpts.sViewPath) ? hOpts.sViewPath : null;
    if (hOpts && hOpts.sRootClassPath)
        this.sRootClassPath = hOpts.sRootClassPath;
    if (process.env.sApp)
        console.log('\nSTARTING: ' + process.env.sApp + oSelf.getEnvDescription(hOpts) +'\n------------###-------------');
    if (fnCallback)
        fnCallback();
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

p.fatal = function (sMsg, oObj, sHtml) {
    var oSelf = this;
    if (!oObj && sMsg) {
        if (sMsg.toString() == '[object Object]')
            oObj = sMsg;
        else
            oObj = {sMsg:sMsg};
    }
    oObj = {stack:new Error().stack, oObj:oObj, sMsg:JSON.stringify(sMsg)};
    this.logger.error('FATAL: ' + sMsg.toString(), oObj);

    var sApp = process.env.sApp||'';
    var Email = require('./Utils/MsgMedia/Email');
    Email.send({
        sFrom:oSelf.hOptions.Email.oQuickMail.from,
        sTo:oSelf.aEmergencyEmails.join(';'),
        sSubject:'Fatal exception log ('+process.env.NORDIS_ENV+'). '+sApp,
        sBody:sMsg.toString()+'<hr/>'+JSON.stringify(oObj).replace(/\\n/g,'<br/>')
    },function(err,hResult){
        oSelf.error(err);
        oSelf.debug(hResult);
    });
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
    var hPackage;
    if (fs.existsSync(process.env.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json')) {
        var hPackage = require(process.env.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json');
        sNordis = '\n NORDIS VERSION: '+hPackage.version;
    }
    var sApp = '';
    if (fs.existsSync(process.env.NORDIS_ENV_ROOT_DIR+'/package.json')) {
        var hPackage = require(process.env.NORDIS_ENV_ROOT_DIR+'/package.json');
        sApp = '\n APP VERSION: '+hPackage.version;
    }
    var sEnv = '\n NORDIS_ENV: ' + process.env.NORDIS_ENV+'\n NORDIS_ENV_CONF: ' + process.env.NORDIS_ENV_CONF;
    if (process.env.NORDIS_ENV_CONF_OVERRIDE)
        sEnv += '\n NORDIS_ENV_CONF_OVERRIDE: '+process.env.NORDIS_ENV_CONF_OVERRIDE;

    return sEnv+sApp+sNordis+sPort+sViews+sWorkerId+sRedisConf+sMySqlConf+sLogLevel;
};

p.publish = function (oObj, hMsg, fnCallback) {
    var oSelf = this;
    var sID = oObj.nClass+':'+oObj.get(oObj.getSettings().sStringKey||oObj.getSettings().sNumericKey);
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

// Needed to add a little sugar to the global Array class to cut out nulls.
global.Array.prototype.clean = function() {
    for (var i = 0; i < this.length; i++) {
        if (this[i] == null || this[i] == undefined) {
            this.splice(i, 1);
            i--;
        }
    }
    return this;
};