var async       = require('async'),
    AppConfig   = require('./../AppConfig'),
    Base        = require('./../Base');
/**
 * This middleware is designed to handle basic api interactions using a semantic routing convention
 * as follows:
 *
 *  <class>/<id>
 *
 *  where 'class' is the lower-case class name, id is the string-key (defined in the sStrinkKey property of the class config)
 *  or the numeric-key (defined in sNumKeyProperty property of the class config) of the object.
 *
 *  The HTTP method is what tells the API middleware what to do:
 *
 *  GET - retrieve details on the resource.
 *  POST - save the resource on the server.
 *  DELETE - delete the resource on the server.
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
                switch (req.method) {
                    case 'POST':
                        if (req.hNordis.oResult)
                            req.hNordis.oResult.save(cb);
                        else
                            cb(AppConfig.getError(500));
                        break;
                    case 'DELETE':
                        if (req.hNordis.oResult)
                            req.hNordis.oResult.delete(cb);
                        else
                            cb(AppConfig.getError(500));
                        break;
                    default:
                        cb();
                        break;
                }
            }
        ],function(err){
            if (err) {
                AppConfig.error(err);
                res.status(500);
                res.end(err);
            } else {
                AppConfig.info(JSON.stringify(req.hNordis.hResult));
                AppConfig.info('END: '+req.path+' ------');
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
var apiPreparser = function(req,res,next){
    async.series([
        function(callback){
            preParse(req,res,next);
        }
        ,function(callback) {
            if (AppConfig.fnMiddleware)
                AppConfig.fnMiddleware(req,res,callback,AppConfig,async);
            else
                callback();
        }
    ],next);
};
/**
 * This method is shared by both apiPreparser and apiParser.
 * @param req
 * @param res
 * @param next
 */
var preParse = function(req,res,fnCallback) {
    req.hNordis = {};

    // hExtras can be requested on GET or POST requests. if GET, the hExtras param must be a JSON string.
    req.hNordis.hExtras = (req.method=='POST') ? req.body.hExtras : (req.query.hExtras) ? req.query.hExtras : null;

    // Parse the request path and figure out what is being requested. The path plus the req.method (POST, GET or DELETE) tell us where to look in the configuration file.
    // While parsing the path, we'll find the configuration settings for the API call.
    var hEndpoint;
    var sConfClass;
    req.path.split('/').forEach(function(sItem,nIndex){
        switch(nIndex) {
            case 1:
                sItem = sItem.toLowerCase();
                // This should be the root class.
                req.hNordis.sClass = (sItem && AppConfig.hClassMap[sItem]) ? AppConfig.hClassMap[sItem] : null;
                sConfClass = AppConfig.hClassMap[sItem];

                break;
            case 2:
                // This should be the id property (either string or numeric).
                req.hNordis.hQuery = {};
                if (AppConfig.hClasses[req.hNordis.sClass]) {
                    if (isNaN(sItem) && AppConfig.hClasses[req.hNordis.sClass] && AppConfig.hClasses[req.hNordis.sClass].sStrKeyProperty) {
                        req.hNordis.sLookupProperty = AppConfig.hClasses[req.hNordis.sClass].sStrKeyProperty;
                    } else {
                        req.hNordis.sLookupProperty = AppConfig.hClasses[req.hNordis.sClass].sNumKeyProperty;
                    }
                        req.hNordis.hQuery[req.hNordis.sLookupProperty] = sItem;

                    // API path as it should be found in configuration.
                    req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}';

                    try {
                        hEndpoint = AppConfig.hClasses[sConfClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method]
                    } catch(err) {}
                }
                break;
            case 3:
                // This is a first-level extra. It must exist in the configuration.
                req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}/'+sItem;

                sConfClass = AppConfig.hClassMap[req.hNordis.sClass.toLowerCase()+'.'+sItem];

                try {
                    hEndpoint = AppConfig.hClasses[sConfClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method]
                } catch(err) {}

                // If requested, this is the root extra so we append what we parsed out above.
                if (req.hNordis.hExtras)
                    req.hNordis.hExtras[sItem] = req.hNordis.hExtras;
                else {
                    req.hNordis.hExtras = {};
                    req.hNordis.hExtras[sItem] = true;
                }
                // We're also going to set an 'sExtra' property on hNordis, because that tells the serializer where to start.
                // When calling an extra in the URI we start there when serializing the result.
                req.hNordis.sExtra = sItem;
                break;
        }
    });

    var handleError = function(err) {
        AppConfig.error(err);
        res.status(500);
        res.end(err);
    };
    var passItOn = function(hResult) {
        req.hNordis.hResult = hResult;
        fnCallback();
    };

    // If the class isn't found move on.
    if (!req.hNordis.sClass) {
        passItOn();
    } else {

        if (!hEndpoint) {
            AppConfig.warn('API call not configured: '+req.path+'. Tried looking in configuration under \''+req.hNordis.sPath+'\' using method '+req.method+' inside class: '+sConfClass);
            passItOn();
        } else {

            async.waterfall([
                // Look up the root object. The hNordis hash will include both the sClass and hQuery needed to look up the object.
                function(cb) {
                    Base.lookup(req.hNordis,cb);
                }
                // Check for fnApiCallProcessor, through which you can write a completely custom handler for setting properties, checking security, and tracking stats.
                // Otherwise, just call setData on POST requests or pass through if not.
                ,function(oResult,cb) {
                    req.hNordis.oResult = oResult;
                    if (hEndpoint.fnApiCallProcessor)
                        hEndpoint.fnApiCallProcessor(req,AppConfig,function(err){
                            cb(err,req.hNordis.oResult);
                        });
                    else if (req.method=='POST') {
                        req.hNordis.oResult.setData(req.body);
                        // We don't actually call save here. That is done in the apiParser method. preParse only gets the object ready to save. You, of course, can save it in your custom fnValidate function.
                        cb(null,req.hNordis.oResult);
                    } else
                        cb(null,req.hNordis.oResult);
                }
                ,function(oResult,cb) {
                    // If the api request is for a nested resource directly, return it directly.
                    if (req.hNordis.sExtra) {
                        req.hNordis.hExtras = req.hNordis.hExtras[req.hNordis.sExtra];
                        req.hNordis.oResult = req.hNordis.oResult[req.hNordis.sExtra];
                    }
                    if (hEndpoint.fnApiCallOutput)
                        hEndpoint.fnApiCallOutput(req,AppConfig,cb);
                    else
                        cb(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
                }
            ],function(err,hResult){
                if (err)
                    handleError(err);
                else
                    passItOn(hResult);
            });
        }
    }
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
};