var async       = require('async'),
    Base        = require('./../Base'),
    Collection  = require('./../Collection'),
    App         = require('./../AppConfig');
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
    req.hData = {nTime:new Date().getTime(),sUrl:req.path,nPort:App.hAppSettings[process.env.sApp].nPort,sEnv:process.env.NORDIS_ENV};
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

    async.series([
        function(callback) {
            var aMatches = req.path.split('/');
            var sClass;
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
                                App.info('Middleware sClass: '+sClass+': '+sID);

                                var hExtras = {};
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
            ],callback);
        }
    ],next);
};


module.exports = {
    parseSession:parseSession
};