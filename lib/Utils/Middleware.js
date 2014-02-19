var async       = require('async'),
    AppConfig   = require('./../AppConfig'),
    Collection  = require('./../Collection'),
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
    req.hNordis = {sPath:req.path};
    if (req.path && req.path != '/') {
        AppConfig.info('START: '+req.method+' '+req.path+' ------');
        preParse(req,res,function(){
            AppConfig.info('END: '+req.method+' '+req.path+' ------');
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
    // hExtras can be requested on GET or POST requests. if GET, the hExtras param must be a JSON string.
    if (req.body || req.query)
        req.hNordis.hExtras = (req.method=='POST') ? req.body.hExtras : (req.query.hExtras) ? req.query.hExtras : null;

    // Parse the request path and figure out what is being requested. The path plus the req.method (POST, GET or DELETE) tell us where to look in the configuration file.
    // While parsing the path, we'll find the configuration settings for the API call.
    req.hNordis.hEndpoint;
    // We're going to keep a small array of the classes we check for a matching api endpoint (for informative errors).
    var aClasses = [];

    if (req.path.match(/\//))
        req.path.split('/').forEach(function(sItem,nIndex){
            switch(nIndex) {
                case 1:
                    sItem = sItem.toLowerCase();
                    // This should be the root class.
                    req.hNordis.sClass = (sItem && AppConfig.hClassMap[sItem]) ? AppConfig.hClassMap[sItem] : null;
                    aClasses.push(req.hNordis.sClass);
                    break;
                case 2:
                    // This should be the id property (either string or numeric).
                    if (AppConfig.hClasses[req.hNordis.sClass]) {
                        req.hNordis.hQuery = {};

                        if (isNaN(sItem) && AppConfig.hClasses[req.hNordis.sClass] && AppConfig.hClasses[req.hNordis.sClass].sStrKeyProperty) {
                            req.hNordis.sLookupProperty = AppConfig.hClasses[req.hNordis.sClass].sStrKeyProperty;
                        } else {
                            req.hNordis.sLookupProperty = AppConfig.hClasses[req.hNordis.sClass].sKeyProperty;
                        }
                            req.hNordis.hQuery[req.hNordis.sLookupProperty] = sItem;

                        // Try literal path as passed in first.
                        req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/'+sItem;

                        try {
                            req.hNordis.hEndpoint = AppConfig.hClasses[req.hNordis.sClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method];
                            // Null out the hQuery so the lookup step below does nothing more than instantiate an empty obj.
                            req.hNordis.hQuery = null;
                        } catch(err) {
                            // Then try {id} in the path.
                            try {
                                req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}';
                                req.hNordis.hEndpoint = AppConfig.hClasses[req.hNordis.sClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method]
                            } catch(err) {
                                req.hNordis.hEndpoint = null;
                            }
                        }
                    }
                    break;
                case 3:

                    if (req.hNordis.sClass) {
                        req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}/'+sItem;

                        // Look in the root class for the matching endpoint.
                        if (AppConfig.hClasses[req.hNordis.sClass]) {
                            try {
                                req.hNordis.hEndpoint = AppConfig.hClasses[req.hNordis.sClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method];
                                req.hNordis.sExtra = sItem;
                            } catch(err) {
                                req.hNordis.hEndpoint = null;
                                req.hNordis.sExtra = null;
                            }
                        }

                        // Now see if the third item in the path is itself a class and check there.
                        if (!req.hNordis.hEndpoint && AppConfig.hClassMap[sItem.toLowerCase()]) {
                            aClasses.push(AppConfig.hClassMap[sItem.toLowerCase()]);
                            try {
                                req.hNordis.hEndpoint = AppConfig.hClasses[AppConfig.hClassMap[sItem.toLowerCase()]].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method];
                                req.hNordis.sExtra = sItem;
                            } catch(err2) {
                                req.hNordis.hEndpoint = null;
                                req.hNordis.sExtra = null;
                            }
                        }

                        // See if the third itme in the page matches an extra on the root class. Find the class type of the extra and look in that class config for the endpoint.
                        if (!req.hNordis.hEndpoint && AppConfig.hClasses[req.hNordis.sClass].hExtras[sItem]) {
                            aClasses.push(AppConfig.hClasses[req.hNordis.sClass].hExtras[sItem].sClass);
                            try {
                                req.hNordis.hEndpoint = AppConfig.hClasses[AppConfig.hClasses[req.hNordis.sClass].hExtras[sItem].sClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method];
                                req.hNordis.sExtra = sItem;
                            } catch (err3) {
                                req.hNordis.hEndpoint = null;
                                req.hNordis.sExtra = null;
                            }
                        }
                    }

                    break;
            }
        });

    // Look in the root of the API definition for non class-related endpoints.
    if (!req.hNordis.sClass && !req.hNordis.hEndpoint) {
        console.log('try top-level');
        try {
            req.hNordis.hEndpoint = AppConfig.hApi.hEndpoints[req.path].hVerbs[req.method];
            req.hNordis.sExtra = null;
        } catch (err) {
            req.hNordis.hEndpoint = null;
            req.hNordis.sExtra = null;
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
    if (!req.hNordis.sClass && !req.hNordis.hEndpoint)
        passItOn();
    else
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

                if (!req.hNordis.hEndpoint)
                    cb('API call not configured: '+req.path+'. Tried looking in configuration under \''+req.hNordis.sPath+'\' using method '+req.method+' inside class(es): '+aClasses.join(','));
                else {
                    AppConfig.debug(req.hNordis.hEndpoint);
                    cb();
                }
            }
            // Set properties on resource for POST requests, and execute fnApiCallProcessor override function if present in config.
            ,function(cb) {
                if (req.hNordis.hEndpoint.fnApiCallProcessor)
                    req.hNordis.hEndpoint.fnApiCallProcessor(req,AppConfig,function(err,result){
                        // This checks for a passed-back result from the override. This means the override
                        // can either set req.hNordis.oResult directly or return the result in the callback.
                        if (result instanceof Base || result instanceof Collection)
                            req.hNordis.oResult = result;

                        cb(err);
                    });
                else {
                    if (req.method=='POST' && req.hNordis.sClass && req.hNordis.oResult) {
                        AppConfig.debug('--- req.body ---');
                        AppConfig.debug(req.body);
                        req.hNordis.oResult.setData(req.body);
                    }
                    cb();
                }

            }
            // Load extras if needed.
            ,function(cb){
                // Before loading any extras, check the endpoint configuration for an override boolean.
                if (req.hNordis.oResult && req.hNordis.hExtras) {
                    AppConfig.debug('Loading Extras---');
                    AppConfig.debug(req.hNordis.hExtras);
                    req.hNordis.oResult.loadExtras(req.hNordis.hExtras,function(err){
                        if (err)
                            cb(err);
                        else {
                            if (req.hNordis.sExtra) {
                                req.hNordis.oResult = req.hNordis.oResult[req.hNordis.sExtra];
                                // The hExtras used for serialization starts at the sExtra:
                                if (req.hNordis.hExtras[req.hNordis.sExtra])
                                    req.hNordis.hExtras = req.hNordis.hExtras[req.hNordis.sExtra].hExtras || true;
                            }
                            cb();
                        }
                    });
                } else
                    cb();
            }
            // Allow user to customize API output (serialization) if desired using the 'fnApiCallOutput' function on the API call definition in config.
            ,function(cb) {
                if (req.hNordis.hEndpoint.fnApiCallOutput)
                    req.hNordis.hEndpoint.fnApiCallOutput(req,AppConfig,cb);
                else if (!req.hNordis.oResult)
                    cb();
                else
                    cb(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
            }
        ],function(err,aResult){
            // If the number of items in the series above changes, then the location of the hash result will also change.
            passItOn(err,aResult[4]);
        });
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
};