var winston = require('winston');

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
 * NORDIS_ENV_CONF - The full path for the config file.
  */
function AppConfig() {
    this.loadOptions({
        sRootClassPath:process.env.NORDIS_ENV_ROOT_DIR+'/lib/',
        sEnvironmentConfigFilePath:process.env.NORDIS_ENV_CONF
    });
}

var p = AppConfig.prototype;
p.hConsumers = {};
p.hEventHandlers = {};

p.loadOptions = function(hOpts) {
    this.sRootClassPath = hOpts.sRootClassPath;
    if (!this.hConstants) {
        var hConf = require(hOpts.sEnvironmentConfigFilePath).hSettings;
        for (var sProp in hConf.global) {
            this[sProp] = hConf.global[sProp];
        }
        // Look for section matching the NORDIS_ENV and use it to override global defaults.
        if (hConf[process.env.NORDIS_ENV]) {
            _appendHash(this,hConf[process.env.NORDIS_ENV]);
        }
    }

    // Check for an environment-specific override .conf file. This is where we change whatever
    // we need to for the environment.
    if (hOpts && hOpts.sEnvironmentConfigFilePath) {
        try {
            var hEnvConf = require(hOpts.sEnvironmentConfigFilePath);
            _appendHash(this,hEnvConf.hSettings.global);
            // Again, look for section matching the NORDIS_ENV and use it to override global defaults.
            // This overrides the overrides above (in the default file).
            _appendHash(this,hEnvConf.hSettings[process.env.NORDIS_ENV]);
        } catch (err) {
            this.info('No environment override file found. Using default settings instead. We looked here: '+hOpts.sEnvironmentConfigFilePath,err);
        }
    }

    // Singleton instances of Redis class. Redis connections are managed in a pool
    this.Redis = require('./Utils/Data/Redis');
    this.Redis.init(this.hOptions.Redis);

    this.MySql = require('./Utils/Data/MySql');
    this.MySql.init(this.hOptions.MySql);

    // Define default data source.
    this.sDefaultDb = (this.hConstants && this.hConstants.sDefaultDb) ? this.hConstants.sDefaultDb : 'MySql';

    // Convenience logging methods. Just require this class in your file and call App.info, App.debug, App.error etc.
    this.logger = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({ level: this.sLogLevel||'error' })
        ]
    });

    // Dynamically update class aProperties with all the image types and sizes.

    for (var sClass in this.hClasses) {
        if (this.hClasses[sClass].hImages) {
            var aImages = []
            for (var sType in this.hClasses[sClass].hImages) {
                aImages.push('s'+sType);
                for (var i = 0; i < this.hClasses[sClass].hImages[sType].aSizes.length; i++) {
                    aImages.push('s'+sType+this.hClasses[sClass].hImages[sType].aSizes[i].nSize);
                }
            }
            this.hClasses[sClass].aProperties = this.hClasses[sClass].aProperties.concat(aImages);
            this.hClasses[sClass].aImages = aImages;
        }
    }
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
    if (hOpts.sRootClassPath)
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

p.exit = function () {
    process.exit();
};

p.getEnvDescription = function(hOpts){
    var oSelf = this;
    var sPort = (oSelf.hAppSettings[process.env.sApp] && oSelf.hAppSettings[process.env.sApp].nPort) ? '\n PORT: ' + oSelf.hAppSettings[process.env.sApp].nPort : '';
    var sViews = (process.env.sViewPath && process.env.sViewPath.match(/\//)) ? '\n VIEW DIR: '+process.env.sViewPath : '';
    var sWorkerId = (hOpts && hOpts.sWorkerId) ? '\n PROCESS ID: '+hOpts.sWorkerId : '';
    var sApiConsumer =  (oSelf.hConsumers[oSelf.sConsumerToken]) ? '\n DEFAULT API CONSUMER: '+oSelf.hConsumers[oSelf.sConsumerToken].getTitle()+' ('+oSelf.hConsumers[oSelf.sConsumerToken].get('nID')+')' : '';
    var sRedisConf = '\n REDIS: '+oSelf.hOptions.Redis.sWriteServer+':'+oSelf.hOptions.Redis.nWritePort;
    var sMySqlConf = '\n MYSQL: '+oSelf.hOptions.MySql.sHost+':'+oSelf.hOptions.MySql.sSchema;

    var hPackage = JSON.parse(fs.readFileSync(process.env.NORDIS_ENV_ROOT_DIR+'/package.json'));
    var sNordis = '\n NORDIS VERSION: '+hPackage.version;

    return '\n NORDIS_ENV: ' + process.env.NORDIS_ENV+sNordis+sPort+sViews+sWorkerId+sApiConsumer+sRedisConf+sMySqlConf;
};

p.publish = function (oObj, hMsg, fnCallback) {
    var oSelf = this;
    var sID = oObj.nClass+':'+oObj.get('sID');
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
//        console.log(sID+' -- '+sData);
//        if (oObj.nClass = 16) {
//            console.log(oObj.nClass+':'+sID);
//            console.log(sData);
//        }
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