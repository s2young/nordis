var async       = require('async'),
    AppConfig   = require('./../AppConfig'),
    Base        = require('./../Base');
/**
 * This boilerplate middleware parses API requests as defined in the config file, AND performs the CRUD operations
 * on the requested resources. This is mainly for evaluative, non-secure, boilerplate purposes. In production, you should
 * use preParser middleware, which prepares the resource (including setting properties on POST operations) but doesn't
 * actually save or delete anything.
 *
 * @param req
 * @param res
 * @param next
 */
var apiParser = function(req,res,next) {
    if (req.path && req.path != '/') {
        apiPreparser(req,res,function(err){
            async.series([
                function(cb) {
                    cb(err);
                }
                ,function(cb) {
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
                    AppConfig.info(req.hNordis.hResult);
                    AppConfig.info('END: '+req.path+' ------');
                    res.end(JSON.stringify(req.hNordis.hResult));
                }
            });
        });
    } else
        next();
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
    if (req.path && req.path != '/') {
        AppConfig.info('START: '+req.path+' ------');
        preParse(req,res,function(){
            AppConfig.info('END: '+req.path+' ------');
            next();
        });
    } else
        next();

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
                if (AppConfig.hClasses[req.hNordis.sClass]) {
                    req.hNordis.hQuery = {};

                    if (isNaN(sItem) && AppConfig.hClasses[req.hNordis.sClass] && AppConfig.hClasses[req.hNordis.sClass].sStrKeyProperty) {
                        req.hNordis.sLookupProperty = AppConfig.hClasses[req.hNordis.sClass].sStrKeyProperty;
                    } else {
                        req.hNordis.sLookupProperty = AppConfig.hClasses[req.hNordis.sClass].sNumKeyProperty;
                    }
                        req.hNordis.hQuery[req.hNordis.sLookupProperty] = sItem;

                    // Try literal path as passed in first.
                    req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/'+sItem;

                    try {
                        hEndpoint = AppConfig.hClasses[sConfClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method];
                        // Null out the hQuery so the lookup step below does nothing more than instantiate an empty obj.
                        req.hNordis.hQuery = null;
                    } catch(err) {
                        // Then try {id} in the path.
                        try {
                            req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}';
                            hEndpoint = AppConfig.hClasses[sConfClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method]
                        } catch(err) {}
                    }
                }
                break;
            case 3:

                if (AppConfig.hClasses[req.hNordis.sClass] && req.hNordis.hQuery) {
                    // This is a first-level extra. It must exist in the configuration.
                    req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}/'+sItem;

                    hEndpoint = null;
                    try {
                        if (AppConfig.hClassMap[req.hNordis.sClass.toLowerCase()+'.'+sItem]) {
                            sConfClass = AppConfig.hClassMap[req.hNordis.sClass.toLowerCase()+'.'+sItem];

                            // If requested, this is the root extra so we append what we parsed out above.
                            var hOpts = req.hNordis.hExtras;
                            if (!req.hNordis.hExtras) {
                                req.hNordis.hExtras = {};
                                req.hNordis.hExtras[sItem] = true;
                            } else if (!req.hNordis.hExtras[sItem]) {
                                delete req.hNordis.hExtras;
                                req.hNordis.hExtras = {}
                                req.hNordis.hExtras[sItem] = {};
                                req.hNordis.hExtras[sItem].hExtras = hOpts;
                            }

                            if (!hOpts)
                                hOpts = req.hNordis.hExtras;
                            req.hNordis.hExtras[sItem].nSize = (hOpts.nSize) ? hOpts.nSize : (req.method=='POST') ? req.body.nSize : (req.query.nSize) ? req.query.nSize : null;
                            req.hNordis.hExtras[sItem].nFirstID = (hOpts.nFirstID) ? hOpts.nFirstID :(req.method=='POST') ? req.body.nFirstID : (req.query.nFirstID) ? req.query.nFirstID : null;
                            req.hNordis.hExtras[sItem].nMin = (hOpts.nMin) ? hOpts.nMin :(req.method=='POST') ? req.body.nMin : (req.query.nMin) ? req.query.nMin : null;

                            // We're also going to set an 'sExtra' property on hNordis, because that tells the serializer where to start.
                            // When calling an extra in the URI we start there when serializing the result.
                            req.hNordis.sExtra = sItem;

                        } else if (AppConfig.hClassMap[sItem]) {
                            sConfClass = AppConfig.hClassMap[sItem];

                        }
                        hEndpoint = AppConfig.hClasses[sConfClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method]
                    } catch(err) {}

                }

                break;
        }
    });
    // Look in the root of the API definition for non class-related endpoints.
    if (!req.hNordis.sClass && !hEndpoint) {
        if (AppConfig.hApi && AppConfig.hApi.hEndpoints && AppConfig.hApi.hEndpoints[req.path]) {
            hEndpoint = AppConfig.hApi.hEndpoints[req.path];
        }
    }

    var passItOn = function(err,hResult) {
        if (err) {
            AppConfig.warn(err);
            req.hNordis.sException = err;
        }
        AppConfig.silly(req.hNordis);

        req.hNordis.hResult = hResult;
        fnCallback(err);
    };

    // If the class isn't found move on.
    if (!req.hNordis.sClass && !hEndpoint) {
        passItOn();
    } else {

        async.series([
            // Look up the root object. The hNordis hash will include both the sClass and hQuery needed to look up the object.
            function(cb) {
                if (req.hNordis.hQuery)
                    Base.lookup({sClass:req.hNordis.sClass,hQuery:req.hNordis.hQuery},function(err,oResult){
                        req.hNordis.oResult = oResult;
                        cb(err);
                    });
                else if (req.hNordis.sClass) {
                    req.hNordis.oResult = Base.lookup({sClass:req.hNordis.sClass});
                    cb();
                } else
                    cb();
            }
            // With the result, we then check for an api configuration for the path.
            // If not found, we just move on and skip the rest of the flow.
            ,function(cb){
                if (req.hNordis.oResult)
                    AppConfig.debug('FOUND req.hNordis.oResult: '+req.hNordis.oResult.sClass+' ('+req.hNordis.oResult.getKey()+')');

                if (!hEndpoint)
                    cb('API call not configured: '+req.path+'. Tried looking in configuration under \''+req.hNordis.sPath+'\' using method '+req.method+' inside class: '+sConfClass);
                else {
                    console.log(hEndpoint);
                    cb();
                }
            }
            // Set properties on resource for POST requests, and execute fnApiCallProcessor override function if present in config.
            ,function(cb) {

                if (req.method=='POST' && req.hNordis.sClass && req.hNordis.oResult && sConfClass == req.hNordis.sClass) {
                    AppConfig.debug('--- req.body ---');
                    AppConfig.debug(req.body);
                    req.hNordis.oResult.setData(req.body);
                }

                if (hEndpoint.fnApiCallProcessor)
                    hEndpoint.fnApiCallProcessor(req,AppConfig,function(err,result){
                        // This checks for a passed-back result from the override. This means the override
                        // can either set req.hNordis.oResult directly or return the result in the callback.
                        if (result)
                            req.hNordis.oResult = result;

                        cb(err);
                    });
                else
                    cb();
            }
            // Load extras if needed.
            ,function(cb){
                // Before loading any extras, check the endpoint configuration for an override boolean.
                if (!hEndpoint.bDisallowExtras && req.hNordis.oResult && req.hNordis.hExtras) {
                    AppConfig.debug('Loading Extras---');
                    AppConfig.debug(req.hNordis.hExtras);
                    req.hNordis.oResult.loadExtras(req.hNordis.hExtras,function(err){
                        if (req.hNordis.sExtra) {
                            req.hNordis.oResult = req.hNordis.oResult[req.hNordis.sExtra];
                            // The hExtras used for serialization starts at the sExtra:
                            req.hNordis.hExtras = req.hNordis.hExtras[req.hNordis.sExtra].hExtras || true;
                        }
                        cb();
                    });
                } else
                    cb();
            }
            // Allow user to customize API output (serialization) if desired using the 'fnApiCallOutput' function on the API call definition in config.
            ,function(cb) {
                if (!req.hNordis.oResult)
                    cb();
                else if (hEndpoint.fnApiCallOutput)
                    hEndpoint.fnApiCallOutput(req,AppConfig,cb);
                else
                    cb(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
            }
        ],function(err,aResult){
            // If the number of items in the series above changes, then the location of the hash result will also change.
            passItOn(err,aResult[4]);
        });
    }
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
};