var async       = require('async'),
    Base        = require('./../Core/Base'),
    Collection  = require('./../Core/Collection'),
    App         = require('./../Core/AppConfig');
/**
 * This middleware method is shared by the engage web and mgr apps and is used to load all the
 * base data in a request including the API Consumer and signed-in user, if any. This MUST be called
 * only after the session
 * @param req
 * @param res
 * @param next
 */
var parseSession = function(req,res,next) {
    // We store all the data that we might use in the request, including the template, in 'hData'
    //    App.info(req.path);
    req.hData = {nTime:new Date().getTime(),sUrl:req.path,nPort:App.hAppSettings[process.env.sApp].nPort,sEnv:process.env.GOBA_ENV};
    // This middleware tells us whether the viewing browser is a mobile one (generally speaking).
    var String  = require('./../Utils/String');
    var aMatches = String.isMobileBrowser(req.headers['user-agent']);
    if (aMatches) {
        var sOS = aMatches[0].toString();
        if (sOS.match(new RegExp(/iP(hone|od|ad)/)))
            req.hData.bApple = true;
        else if (sOS.match(new RegExp(/android/i)))
            req.hData.bAndroid = true;
    } else
        req.hData.bDesktop = true;

    req.hData.oApiConsumer = App.getConsumer(req.host); // The api consumer should always be loaded (via init method inside AppConfig)
    if (!req.hData.oApiConsumer)
        req.hData.oApiConsumer = App.getConsumer();

    // First, load the user.  Then we can do some stuff in parallel.
    async.series([
        function(callback) {
            if (req.session && req.session.sToken) {
                new Collection({sClass:'Platform',hQuery:{sToken:req.session.sToken,nApiConsumerID:req.hData.oApiConsumer.get('nID')},hExtras:{oUser:true}},function(err,cColl){
                    if (cColl && cColl.nTotal == 1 && cColl.first().oUser) {
                        req.hData.oPlatform = cColl.first();
                        req.hData.oUser = req.hData.oPlatform.oUser;
                    }
                    callback(err);
                });
            } else if (req.query && (req.query.sID))
                Base.lookup({sClass:'Permit',hQuery:{sID:req.query.sID},hExtras:{oUser:{hExtras:{cPlatforms:true}}}},function(err,oPermit){
                    if (oPermit && oPermit.get('nID') && oPermit.oUser && oPermit.oUser.get('nID')) {
                        req.hData.oPlatform = oPermit.oUser.getPlatform({nMedium:App.nMedium_Email,nApiConsumerID:req.hData.oApiConsumer.get('nID')});
                        if (req.hData.oPlatform) {
                            async.parallel([
                                function(cb) {
                                    oPermit.oUser.set('bConfirmed',true);
                                    oPermit.oUser.save(null,cb);
                                },
                                function(cb) {
                                    req.hData.oPlatform.set('bConfirmed',true);
                                    req.hData.oPlatform.save(null,cb);
                                }
                            ],function(err){
                                callback(err);
                            });
                        } else
                            callback();
                    } else
                        callback();
                });
            else
                callback();
        },
        function(callback) {
            var aMatches = req.path.split('/');
            var sClass;
            var sSource;
            if (aMatches && aMatches.length > 1)
                sClass = App.hAPIHelper[aMatches[1].toLowerCase()];

            async.parallel([
                function(cb) {
                    if (!sClass)
                        cb();
                    else {
                        var sID = (aMatches && aMatches[2]) ? aMatches[2].toString() : null;
                        if (sID == 'new') {
                            req.hData.oObj = Base.lookup({sClass:sClass});
                            cb();
                        } else if (sID) {
                            if (!sClass || !sID || sClass == 'undefined' || sID == 'undefined')
                                cb();
                            else {
                                var hQuery = (isNaN(sID) === true) ? {sID:sID} : {nID:sID};
                                //App.info('Middleware sClass: '+sClass+': '+sID);

                                var hExtras = {};
                                switch (sClass) {
                                    case 'Event':
                                        hExtras = {
                                            oPlace:true,
                                            oGroup:true,
                                            oOwner:true,
                                            cInvitees:{nIndex:0,nSize:1}
                                        };
                                        break;
                                    case 'Group':
                                        hExtras = {
                                            oPlace:true,
                                            oOwner:true,
                                            cMembers:{nIndex:0,nSize:1}
                                        };
                                        break;
                                    case 'Page':
                                        hExtras = {
                                            oPlace:true
                                        };
                                        break;
                                }

                                Base.lookup({
                                    sClass:sClass,
                                    hQuery:hQuery,
                                    hExtras:hExtras
                                },function(err,oObj){
                                    req.hData.oObj = oObj;
                                    cb();
                                });
                            }
                        } else
                            cb();
                    }
                }
                ,function(cb) {
                    // If a user is accessing a role/rsvp directly, they take on that identity.
                    var sRID = (aMatches && aMatches[3]) ? aMatches[3].toString() : '';
                    if (sRID && !sRID.match('.html')) {
                        var sRClass = (sClass == 'Event') ? 'RSVP' : (sClass == 'Group') ? 'Role' : null;
                        var hQuery = (isNaN(sRID) === true) ? {sID:sRID} : {nID:sRID};

                        if (sRClass) {
//                            App.info('Middleware sRClass: '+sRClass+': '+sRID);
                            Base.lookup({
                                sClass:sRClass,
                                hQuery:hQuery,
                                hExtras:{
                                    oUser:{hExtras:{cPlatforms:true}}
                                }
                            },function(err,oResult){
                                if (!oResult || !oResult.get('nID')) {
                                    cb(null,sRID);
                                } else {
                                    req.hData.oR = oResult;
                                    req.hData.oUser = oResult.oUser;
                                    // Find primary platform:
                                    var oPlatform = req.hData.oUser.getPlatform({bPrimary:true});
                                    if (!oPlatform && req.hData.oUser.cPlatforms)
                                        oPlatform = req.hData.oUser.cPlatforms.first();

                                    if (oPlatform)
                                        req.session.sToken = oPlatform.get('sToken');
                                    cb();
                                }
                            });
                        } else
                            cb();
                    } else
                        cb();
                }

            ],function(err,aResults){
                if (!aResults[1])
                    callback();
                else
                    Base.lookup({sClass:'User',hQuery:{sID:aResults[1]},hExtras:{cPlatforms:true}},function(err,oUser){
                        if (err || !oUser || !oUser.get('nID'))
                            callback(err);
                        else {
                            req.hData.oUser = oUser;
                            req.hData.oPlatform = oUser.getPlatform({nMedium:App.nMedium_Email,nApiConsumerID:req.hData.oApiConsumer.get('nID')});
                            if (req.hData.oPlatform)
                                req.session.sToken = req.hData.oPlatform.get('sToken');
                            oUser.getR(req.hData.oObj,function(err,oR){
                                req.hData.oR = oR;
                                callback(err);
                            });
                        }
                    });
            });
        }
    ],next);
};

var parseSubmittedFiles = function(req,res,next) {
    var AS3 = require('./../Utils/Data/AS3');
    AS3.parseSubmittedFiles(req,res,next);
};

var uploadMiddleware = function(req,res,next) {
    var AS3 = require('./../Utils/Data/AS3');
    AS3.uploadMiddleware(req,res,next);
};

var loadUserByToken = function(sToken,fnCallback) {
    var Base = require('./../Core/Base');
    Base.lookup({sClass:'Platform',hQuery:{sToken:sToken}},function(err,oPlatform){
        if (err)
            fnCallback(err);
        else if (!oPlatform.get('nUserID'))
            fnCallback();
        else
            Base.lookup({sClass:'User',hQuery:{nID:oPlatform.get('nUserID')}},function(err,oUser){
                if (oUser)
                    oUser.oPlatform = oPlatform;
                fnCallback(err,oUser);
            });
    });
};

module.exports = {
    parseSession:parseSession,
    loadUserByToken:loadUserByToken,
    parseSubmittedFiles:parseSubmittedFiles,
    uploadMiddleware:uploadMiddleware
};