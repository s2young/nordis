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
        App.info(JSON.stringify(req.hResult));
        App.info('END: '+req.path+' ------');
        res.end(JSON.stringify(req.hResult));
    });
};

var apiPreparser = function(req,res,next) {
    // Split the req.path into it's parts.
    App.info('START: '+req.path);
    var aPath = req.path.split('/');
    var sClass = (aPath && aPath[1]) ? App.hClassMap[aPath[1]] : null

    var handleError = function(err) {
        App.error(err);
        res.status(500);
        res.end(err);
    };
    var passItOn = function(hResult) {
        req.hResult = hResult;
        next();
    };

    if (!req.path.match(/\.json$/) || aPath.length != 4 || !sClass) {
        handleError(err);
    } else {
        // The first item in the path should be in the hClassMap.
        var sID = aPath[2];
        var sAction = aPath[3].replace('.json','');
        Base.lookup({sClass:sClass,hQuery:{sID:sID}},function(err,oObj){
            if (err)
                handleError(err);
            else {
                req.oResult = oObj;
                var hExtras = req.body.hExtras;

                async.series([
                    // Check to see if we're saving anything on this object.
                    function(cb) {
                        if (sAction == 'save') {
                            for (var i=0; i<App.hClasses[sClass].aProperties.length; i++) {
                                var sProperty = App.hClasses[sClass].aProperties[i];
                                if (req.body[sProperty] != undefined)
                                    req.oResult.set(sProperty,req.body[sProperty]);
                            }
                            req.oResult.save(null,cb);
                        } else
                            cb();
                    }
                    // Load extras and switch context if needed.
                    ,function(cb){
                        if (req.oResult.hSettings() && req.oResult.hSettings().hExtras && req.oResult.hSettings().hExtras[sAction]) {
                            // We're digging into the oResult's object tree and switching to that as the root oResult for the request.
                            hExtras = {};
                            hExtras[sAction] = req.body;
                            req.oResult.loadExtras(hExtras,function(err){
                                hExtras = hExtras[sAction].hExtras;
                                req.oResult = req.oResult[sAction];
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