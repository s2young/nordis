var async   = require('async'),
    App     = require('./../AppConfig'),
    Base    = require('./../Base');
/**
 * This middleware is designed to handle basic api interactions using a semantic routing convention
 * as follows:
 *
 *  <class>/<id>/<action>.json
 *
 *  where 'class' is the lower-case class name, id is the sID of the object (or 'new' for object creations),
 *  and action is the action to be performed (save.json, details.json, delete.json), or extra property to be retrieved.
 *
 *  You can use the apiPreparser method, which places the principal object and (and it's toHash result) onto req.oResult
 *  and req.hResult (respectively), and calls next() where you can process it further if you like.
 *
 *  Or you can use the apiParser method, which responds directly to the request using res.end() method.
 *
 * @param req
 * @param res
 * @param next
 */
var apiParser = function(req,res,next) {
    apiPreparser(req,res,function(){
        async.series([
            function(cb) {
                switch (req.sAction) {
                    case 'save':
                        req.oResult.save(null,cb);
                        break;
                    case 'default':
                        req.oResult.delete(cb);
                        break;
                    default:
                        cb();
                        break;
                }
            }
        ],function(err){
            console.log(err);
            if (err) {
                App.error(err);
                res.status(500);
                res.end(err);
            } else if (!req.sAction || !req.sClass || !req.sAction.match(/\.json$/)) {
                App.error(err);
                res.status(500);
                res.end(App.getError(500));
            } else {
                App.info(JSON.stringify(req.hResult));
                App.info('END: '+req.path+' ------');
                res.end(JSON.stringify(req.hResult));
            }
        });
    });
};
/**
 * Use this method if you need to do any extra processing of the api request. This method performs retrieval, saving, etc
 * and places an oResult (a Base object) and an hResult (a hash/dictionary object ready to be serialized) on the request
 * for further processing by the app.
 *
 * @param req
 * @param res
 * @param next
 */
var apiPreparser = function(req,res,next) {
    // Split the req.path into it's parts.
    App.info('START: '+req.path);
    var aPath = req.path.split('/');
    req.sClass = (aPath && aPath[1] && App.hClassMap[aPath[1].toLowerCase()]) ? App.hClassMap[aPath[1].toLowerCase()] : null;

    var handleError = function(err) {
        App.error(err);
        res.status(500);
        res.end(err);
    };
    var passItOn = function(hResult) {
        req.hResult = hResult;
        next();
    };

    req.sAction = (aPath && aPath[3]) ? aPath[3].toLowerCase() : null;
    if (!req.sAction || !req.sClass || !req.sAction.match(/\.json$/)) {
        next();
    } else {
        // The first item in the path should be in the hClassMap.
        req.sID = aPath[2];
        Base.lookup({sClass:req.sClass,hQuery:{sID:req.sID}},function(err,oObj){
            if (err)
                handleError(err);
            else {
                req.oResult = oObj;
                var hExtras = req.body.hExtras;

                async.series([
                    // Check to see if we're saving anything on this object.
                    function(cb) {
                        if (req.sAction == 'save.json') {
                            for (var i=0; i<App.hClasses[req.sClass].aProperties.length; i++) {
                                var sProperty = App.hClasses[req.sClass].aProperties[i];
                                if (req.body[sProperty] != undefined)
                                    req.oResult.set(sProperty,req.body[sProperty]);
                            }
                        }
                        cb();
                    }
                    // Load extras and switch context if needed.
                    ,function(cb){
                        var sExtra = req.sAction.replace('.json','');
                        if (req.oResult.hSettings() && req.oResult.hSettings().hExtras && req.oResult.hSettings().hExtras[sExtra]) {
                            // We're digging into the oResult's object tree and switching to that as the root oResult for the request.
                            hExtras = {};
                            hExtras[sExtra] = req.body;
                            req.oResult.loadExtras(hExtras,function(err){
                                hExtras = hExtras[sExtra].hExtras;
                                req.oResult = req.oResult[sExtra];
                                cb(err);
                            });
                        } else if (hExtras)
                            req.oResult.loadExtras(hExtras,cb);
                        else
                            cb();
                    }
                ],function(err){
                    if (err)
                        handleError(err);
                    else
                        passItOn(req.oResult.toHash(hExtras));
                });
            }
        });
    }
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
};