var async   = require('async'),
    winston = require('winston');

/**
 * In order to run properly, the environment needs to be configured with the following:
 *
 * NORDIS_ENV - This string is used in allowing environment-specific configuration. The conf file
 * contains top-level keys named for specific environments with 'global' being the defaults for all
 * environments. This way, one can configure an environment with appropriate connection settings, IP
 * addresses, etc.
 *
 * NORDIS_ENV_ROOT_NODE_DIR - This is the root directory under which all library code is stored. This allows
 * easy porting between servers and environments, and even having multiple environments on a single
 * machine, running in different directories.
 *
 * NORDIS_ENV_CONF - The full path for the config file.
  */
function AppConfig() {
    this.loadOptions({
        sDefaultConfigFilePath:process.env.NORDIS_ENV_ROOT_NODE_DIR+'/config/conf.js',
        sRootClassPath:process.env.NORDIS_ENV_ROOT_NODE_DIR+'/lib/Model/',
        sEnvironmentConfigFilePath:process.env.NORDIS_ENV_CONF
    });
}

var p = AppConfig.prototype;
p.hConsumers = {};
p.hEventHandlers = {default:{}};

p.loadOptions = function(hOpts) {
    this.sRootClassPath = hOpts.sRootClassPath;
    if (!this.hConstants) {
        var sDefaultConfigFilePath = (hOpts && hOpts.sDefaultConfigFilePath) ? hOpts.sDefaultConfigFilePath : './../config/conf.js';
        var hConf = require(sDefaultConfigFilePath).hSettings;
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
    this.Redis = require('./../Utils/Data/Redis');
    this.Redis.init(this.hOptions.Redis);

    this.MySql = require('./../Utils/Data/MySql');
    this.MySql.init(this.hOptions.MySql);

    // Define default data source.
    this.sDefaultDb = (this.hConstants && this.hConstants.sDefaultDb) ? this.hConstants.sDefaultDb : 'MySql';

    // Convenience logging methods. Just require this class in your file and call App.info, App.debug, App.error etc.
    this.logger = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({ level: this.hConstants.sLogLevel||'error' })
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

    process.on('uncaughtException', function(err) {
        // handle the error safely
        var oStack = new Error().stack;
        oSelf.fatal(err,oStack);

        if (cluster.worker)
            cluster.worker.kill();
        else
            App.exit();
    });

    if (process.env.sApp)
        console.log('\nSTARTING: ' + process.env.sApp + oSelf.getEnvDescription(hOpts) +'\n------------###-------------');

    fnCallback();
};

p.debug = function (sMsg, oObj) {
    if (sMsg)
        this.logger.debug(this.combine(sMsg, oObj), oObj);
};

p.info = function (sMsg, oObj) {
    if (sMsg)
        this.logger.info(this.combine(sMsg, oObj), oObj);
};

p.warn = function (sMsg, oObj) {
    if (sMsg)
        this.logger.warn(this.combine(sMsg, oObj), oObj);
};

p.error = function (sMsg, oObj) {
    var oSelf = this;
    if (sMsg || oObj) {
        var Exception = require('./Exception');

        if (!oObj)
            oObj = {sMsg:sMsg};
        else if (oObj instanceof Exception)
            sMsg = oObj.sMessage;

        sMsg = (sMsg) ? sMsg.toString() : '';
        this.logger.error(sMsg.toString(), oObj);
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

    var sApp = (process.env.sApp) ? process.env.sApp : '';
    var Email = require(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/lib/Utils/MsgMedia/Email');
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
        this.logger.info(process.env.sApp+': '+sMsg);
};

p.done = function (oData, sHtml) {
    this.logger.info(process.env.sApp+': DONE!');
};

p.profile = function (sName) {
    this.logger.profile(sName);
};
/**
 * This method helps make sure that complex objects are stringified before
 * being passed to the winston logger.
 *
 * @param sMsg
 * @param oObj
 * @return {*}
 */
p.combine = function (sMsg, oObj) {
    if (sMsg && sMsg.toString() == '[object Object]')
        try {
            sMsg = JSON.stringify(sMsg, null, 4);
        } catch (err) {
            return sMsg;
        }
    if (sMsg)
        sMsg = process.env.sApp + ':' + sMsg;

    if (oObj && oObj.toString() != '[object Object]' && oObj != 'undefined')
        return sMsg + ':' + oObj;
    else
        return sMsg;
};

/**
 * When writing apps, always include this module and use App.exit() instead of process.exit().
 * The reason is that if any fatal errors occur during the script this method makes sure the emailing
 * and/or texting processes are completed before the app exits.  This ensures that we get the fatal
 * error message.  Otherwise, the process could exit before the emailing/texting is completed and we
 * never know about the fatality.
 */
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
    return '\n NORDIS_ENV: ' + process.env.NORDIS_ENV+sPort+sViews+sWorkerId+sApiConsumer+sRedisConf+sMySqlConf;
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

module.exports.nClass_Event = 1;
module.exports.nClass_User = 2;
module.exports.nClass_Role = 3;
module.exports.nClass_ChildDirectory = 4;
module.exports.nClass_AppMenu = 5;
module.exports.nClass_GImage = 6;
module.exports.nClass_Message = 7;
module.exports.nClass_UserReset = 8;
module.exports.nClass_RSVP = 9;
module.exports.nClass_Stream = 10;
module.exports.nClass_Comment = 11;
module.exports.nClass_Group = 12;
module.exports.nClass_AppMenuType = 13;
module.exports.nClass_Member = 14;
module.exports.nClass_Platform = 15;
module.exports.nClass_Consumer = 16;
module.exports.nClass_Directory = 17;
module.exports.nClass_Permit = 18;
module.exports.nClass_Page = 19;
module.exports.nClass_PaymentPlan = 20;
module.exports.nClass_Geo = 21;
module.exports.nClass_Customer = 23;
module.exports.nClass_Exception = 25;
module.exports.nClass_Invoice = 26;
module.exports.nClass_MsgResult = 28;
module.exports.nClass_MsgIn = 29;
module.exports.nClass_News = 30;
module.exports.nClass_Feed = 31;
module.exports.nClass_Stats = 32;
module.exports.nClass_DayStats = 33;
module.exports.nClass_URL = 36;
module.exports.nClass_PhoneNumber = 50;
module.exports.nClass_TTJ = 51;
module.exports.nClass_Place = 55;

// Message status constants //
module.exports.nMsgStatus_Unsent 			= 0;
module.exports.nMsgStatus_Sent 			    = 1;
module.exports.nMsgStatus_Failed 			= 2;
module.exports.nMsgStatus_Returned			= 3;
module.exports.nMsgStatus_Requeued			= 4;
module.exports.nMsgStatus_Skipped			= 5;
module.exports.nMsgStatus_AwaitingRetrieval = 6;
module.exports.nMsgStatus_Delivered		    = 7;
module.exports.nMsgStatus_Spam				= 8;
module.exports.nMsgStatus_Paused			= 9;
module.exports.nMsgStatus_Sender			= 10;
module.exports.hMsgStatus = {
    0:'Unsent',
    1:'Sent',
    2:'Failed',
    3:'Returned',
    4:'Requeued',
    5:'Skipped',
    7:'Delivered',
    8:'Spam',
    9:'Paused',
    10:'Sender'
};

// Message Medium constants //
module.exports.nMedium_Default	= 0;
module.exports.nMedium_Paused	= 1;
module.exports.nMedium_Email 	= 2;
module.exports.nMedium_TextMsg	= 3;
module.exports.nMedium_Facebook	= 4;
module.exports.nMedium_Twitter	= 5;
module.exports.nMedium_iOS		= 6;
module.exports.nMedium_Android	= 7;
module.exports.nMedium_Foursquare= 8;
module.exports.nMedium_MobileWeb= 9;
module.exports.nMedium_Failure	= 10;
module.exports.nMedium_None		= 12;
module.exports.nMedium_Push		= 13;
module.exports.hMedia = {
    0:'Default',
    1:'Paused',
    2:'Email',
    3:'TextMsg',
    4:'Facebook',
    5:'Twitter',
    6:'Apple',
    7:'Android',
    8:'Foursquare',
    9:'MobileWeb',
    10:'Failure',
    12:'None',
    13:'Push'
};

// User Platform Types //
module.exports.nPlatformType_None       = 0;
module.exports.nPlatformType_Web        = 1;
module.exports.nPlatformType_MobileApp  = 2;
module.exports.nPlatformType_TextMsg    = 3;
// User Platform Status Values //
module.exports.nPlatformStatus_New          = 0;
module.exports.nPlatformStatus_Active       = 1;
module.exports.nPlatformStatus_Suspended    = 2;
module.exports.nPlatformStatus_Revoked      = 3;
module.exports.nPlatformStatus_Deactivated  = 4;
module.exports.nPlatformStatus_OptedOut     = 5;
module.exports.nPlatformStatus_ForceOptOut  = 6;
module.exports.nPlatformStatus_PushFailure  = 7;
module.exports.nPlatformStatus_SMSFailure   = 8;
module.exports.nPlatformStatus_Bounced      = 9;
module.exports.nPlatformStatus_Reset        = 10;
module.exports.nPlatformStatus_ForceUpdate  = 11;
module.exports.hPlatformStatus = {
    0:' - New',
    1:' - Active',
    2:' - Suspended',
    3:' - Revoked',
    4:' - Deactivated',
    5:' - Opted Out',
    6:' - Force-Opted Out',
    7:' - Push Failure',
    8:' - SMS Failure',
    9:' - Bounced',
    10:' - Marked for Reset',
    11:' - Marked for Update'
};
// User Platform OS Types //
module.exports.nOS_None     = 0;
module.exports.nOS_iOS      = 1;
module.exports.nOS_Android  = 2;
module.exports.hOS = {
    0:'None',
    1:'Apple',
    2:'Android'
};
// Group Types //
module.exports.nGroupType_Private        = 0;
module.exports.nGroupType_AlsoPublic     = 1;
module.exports.nGroupType_Public         = 2;
//module.exports.nGroupType_Network        = 3;
//module.exports.nGroupType_Affinity       = 4;
//module.exports.nGroupType_Feed           = 5;
module.exports.nGroupType_TTJ            = 6;
//module.exports.nGroupType_TTJ_Affinity   = 7;
module.exports.nGroupType_Resource        = 8;
module.exports.nGroupType_BuildDistro    = 9;
module.exports.nGroupType_Featured      = 10;
// Role Levels //
module.exports.nRoleStatus_None          = 0;
module.exports.nRoleStatus_Owner         = 1; // User created the group, and is therefore the owner;
module.exports.nRoleStatus_Removed       = 2; // User who created the group also removed it.
module.exports.nRoleStatus_Admin         = 3; // User is designated an admin by owner.
module.exports.nRoleStatus_Member        = 4; // Group member, added by other or joined himself.
module.exports.nRoleStatus_MemberWarned  = 5; // Group member warned, which means maybe a post was marked as abuse. Future posts are hidden until warning removed.
module.exports.nRoleStatus_Banned  = 6; // Group member banned - can't rejoin, post, create events or view the group.
// Group/Event Access Levels //

module.exports.nAccessLevel_Default     = 0;
module.exports.nAccessLevel_Admin       = 1;
module.exports.nAccessLevel_Post        = 2;
module.exports.nAccessLevel_Edit        = 3;
module.exports.nAccessLevel_Invite      = 4;
module.exports.nAccessLevel_Post_Edit   = 5;
module.exports.nAccessLevel_Post_Invite = 6;
module.exports.nAccessLevel_Edit_Invite = 7;
module.exports.nAccessLevel_None        = 8;

module.exports.nFilterType_Prod = 1;
module.exports.nFilterType_Remind = 2;

// Comment Constants //
module.exports.nCommentType_Standard    = 0;
module.exports.nCommentType_Prod        = 1;
module.exports.nCommentType_Remind      = 2;
module.exports.nCommentType_Cancel      = 3;
module.exports.nCommentType_EventUpdate = 4;
module.exports.nCommentType_GroupUpdate = 5;
module.exports.nCommentType_GroupRemove = 6;
module.exports.nCommentType_UrlRedirect = 7;
module.exports.nCommentType_AppRedirect = 8;
module.exports.nCommentType_UnitTest    = 9;
module.exports.nCommentType_Tweet       = 10;
module.exports.nCommentType_Image       = 11;
module.exports.nCommentType_Android     = 12;
module.exports.nCommentType_IOS         = 13;
module.exports.nCommentType_GroupEventPromo = 14;
module.exports.nCommentType_Simple = 15;
module.exports.hCommentType = {
    0:'Standard',
    1:'Prod',
    2:'Remind',
    3:'Cancel',
    4:'Event Update',
    5:'Group Update',
    6:'Group Remove',
    7:'Url Redirect',
    8:'In-App Redirect',
    9:'Unit Test',
    10:'Tweet',
    11:'Image Upload',
    12:'Android Build Upload',
    13:'iOS Build Upload',
    14:'Group/Event Promo Msg',
    15:'Simple Push Promo'
};

module.exports.nCommentStatus_Standard = 0;
module.exports.nCommentStatus_Removed = 1;
module.exports.hCommentStatus = {
    0:'Standard',
    1:'Removed'
};

module.exports.nPermitLevel_Owner   = 0;
module.exports.nPermitLevel_Admin   = 1;
module.exports.nPermitLevel_All     = 2;

// Event Status //
module.exports.nEventStatus_InActive 	= 0;
module.exports.nEventStatus_Active 		= 1;
module.exports.nEventStatus_Cancelled	= 2;
module.exports.nEventStatus_UnConfirmed = 4;
module.exports.nEventStatus_Deleted		= 5;

module.exports.nEventType_Private       = 0;
module.exports.nEventType_AlsoPublic    = 1;
module.exports.nEventType_Public        = 2;
module.exports.nEventType_Network       = 3;
module.exports.nEventType_PublicImported= 4;
module.exports.nEventType_Calendar      = 5;
module.exports.nEventType_PrivateImported= 6;
module.exports.nEventType_Featured      = 10;

module.exports.hEventType = {
    0:'Private',
    1:'Public',
    2:'Public',
    3:'Network-Only',
    4:'Calendar',
    5:'Static Calendar'
};

module.exports.nPlaceStatus_Active  = 0;
module.exports.nPlaceStatus_Removed = 1;
module.exports.hPlaceStatus = {
    0:'Active',
    1:'Removed'
};

module.exports.nRsvpStatus_None         = 0;
module.exports.nRsvpStatus_Invited      = 1;
module.exports.nRsvpStatus_Removed      = 7;
module.exports.nRsvpStatus_Owner        = 9;
module.exports.nRsvpStatus_Banned       = 10;
module.exports.hRsvpStatus = {
    0:'None',
    1:'Invited',
    7:'Removed',
    9:'Owner',
    10:'Banned'
};

module.exports.nApiConsumerLevel_Standard = 0;
module.exports.nApiConsumerLevel_Internal = 1;
module.exports.nApiConsumerLevel_InternalWithSMS = 2;
module.exports.nApiConsumerLevel_NoPIN = 3;
module.exports.hApiConsumerLevel = {
    0:'Standard',1:'Internal App',2:'Internal App w/ SMS',3:'No PIN Requirement'};

module.exports.nStreamType_New     = 0;
module.exports.nStreamType_Updated = 1;
module.exports.nStreamType_Deleted = 2;
module.exports.nStreamType_Hidden  = 3;
module.exports.nStreamType_CategoryChange = 4;
module.exports.hStreamType = {

};

module.exports.sPermit_Admin = 'Admin';
module.exports.sPermit_Create = 'Create';
module.exports.sPermit_ReadOnly = 'Read';
module.exports.sPermit_SuperAdmin = 'SuperAdmin';

module.exports.nCategoryType_Category = 1;
module.exports.nCategoryType_Item = 2;

module.exports.nAppMenuType_Settings    = 0;
module.exports.nAppMenuType_Group       = 1;
module.exports.nAppMenuType_Event       = 2;
module.exports.nAppMenuType_News        = 3;
module.exports.nAppMenuType_Resources     = 4;
module.exports.nAppMenuType_WebView     = 5;
module.exports.nAppMenuType_Calendar    = 6;
module.exports.nAppMenuType_Category    = 7;
module.exports.nAppMenuType_ChildDirectory= 8;
module.exports.nAppMenuType_Pages       = 9;
module.exports.nAppMenuType_WorldPicker = 10;
module.exports.nAppMenuType_Directory   = 11;

module.exports.nFeedType_RSS                = 1;
module.exports.nFeedType_Twitter            = 2;
module.exports.nFeedType_GoogleCalendar     = 3;
module.exports.nFeedType_ICSCalendar        = 4;
module.exports.nFeedType_ICSCalendarSimple  = 5;
module.exports.nFeedType_GoogleCalendarSimple = 6;

module.exports.nDirectoryType_Standard = 1;
module.exports.nDirectoryType_Child = 2;
