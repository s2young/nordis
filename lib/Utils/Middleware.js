var async   = require('async'),
    App     = require('./../AppConfig'),
    Base    = require('./../Base');
/**
 * This middleware is designed to handle basic api interactions using a semantic routing convention
 * as follows:
 *
 *  <class>/<id>/<action>.json
 *
 *  where 'class' is the lower-case class name, id is the string-key (defined in the sStrinkKey property of the class config)
 *  or the numeric-key (defined in sNumKeyProperty property of the class config) of the object. You can pass 'new' for new object creations.
 *  The last section of the path is the action to be performed (save.json, details.json, delete.json), or extra property to be retrieved + .json suffix.
 *
 *  You can use the apiPreparser method, which places the principal object and (and it's toHash result) onto req.oResult
 *  and req.hResult (respectively), and calls next() where you can process it further if you like.
 *
 *  Or you can use the apiParser method, which responds directly to the request using res.end() method.
 *
 * @param req
 * @param res
 */
var apiParser = function(req,res) {
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

            if (err) {
                App.error(err);
                res.status(500);
                res.end(err);
            } else if (!req.hNordis.sAction || !req.hNordis.sClass || !req.hNordis.sAction.match(/\.json$/)) {
                App.error(err);
                res.status(500);
                res.end(App.getError(500));
            } else {
                App.info(JSON.stringify(req.hNordis.hResult));
                App.info('END: '+req.path+' ------');
                res.end(JSON.stringify(req.hNordis.hResult));
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
    req.hNordis = {};
    // Split the req.path into it's parts.
    App.info('START: '+req.path);
    var aPath = req.path.split('/');
    req.hNordis.sClass = (aPath && aPath[1] && App.hClassMap[aPath[1].toLowerCase()]) ? App.hClassMap[aPath[1].toLowerCase()] : null;

    var handleError = function(err) {
        App.error(err);
        res.status(500);
        res.end(err);
    };
    var passItOn = function(hResult) {
        req.hNordis.hResult = hResult;
        next();
    };

    req.hNordis.sAction = (aPath && aPath[3]) ? aPath[3] : null;

    if (!req.hNordis.sAction || !req.hNordis.sClass) {
        next();
    } else {
        // The first item in the path should be in the hClassMap.
        req.hNordis.hQuery = {};
        if (isNaN(aPath[2]) && App.hClasses[req.hNordis.sClass] && App.hClasses[req.hNordis.sClass].sStrKeyProperty) {
            req.hNordis.hQuery[App.hClasses[req.hNordis.sClass].sStrKeyProperty] = aPath[2];
        } else {
            req.hNordis.hQuery[App.hClasses[req.hNordis.sClass].sNumKeyProperty] = aPath[2];
        }
        App.info(req.hNordis.hQuery);

        Base.lookup({sClass:req.hNordis.sClass,hQuery:req.hNordis.hQuery},function(err,oObj){
            if (err)
                handleError(err);
            else {
                req.hNordis.oResult = oObj;

                if (req.hNordis.sAction.toLowerCase().match(/\.json$/)) {

                    var hExtras = req.body.hExtras;
                    async.series([
                        // Check to see if we're saving anything on this object.
                        function(cb) {
                            if (req.hNordis.sAction.toLowerCase() == 'save.json') {
                                App.hClasses[req.hNordis.sClass].aProperties.forEach(function(sProperty){
                                    if (req.body[sProperty] != undefined)
                                        req.hNordis.oResult.set(sProperty,req.body[sProperty]);
                                });
                            }
                            cb();
                        }
                        // Load extras and switch context if needed.
                        ,function(cb){
                            var sExtra = req.hNordis.sAction.replace(/\.json$/i,'');
                            if (req.hNordis.oResult.getSettings() && req.hNordis.oResult.getSettings().hExtras && req.hNordis.oResult.getSettings().hExtras[sExtra]) {
                                // We're digging into the oResult's object tree and switching to that as the root oResult for the request.
                                hExtras = {};
                                hExtras[sExtra] = req.body;
                                req.hNordis.oResult.loadExtras(hExtras,function(err){
                                    hExtras = hExtras[sExtra].hExtras;
                                    req.hNordis.oResult = req.hNordis.oResult[sExtra];
                                    cb(err);
                                });
                            } else if (hExtras) {
                                req.hNordis.oResult.loadExtras(hExtras,cb);
                            } else
                                cb();
                        }
                    ],function(err){
                        if (err)
                            handleError(err);
                        else
                            passItOn(req.hNordis.oResult.toHash(hExtras));
                    });
                } else
                    passItOn();
            }
        });
    }
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
};