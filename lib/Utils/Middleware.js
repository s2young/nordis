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

                    // API path as it should be found in configuration.
                    req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}';

                    try {
                        hEndpoint = AppConfig.hClasses[sConfClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method]
                    } catch(err) {}
                }
                break;
            case 3:

                if (AppConfig.hClasses[req.hNordis.sClass] && req.hNordis.hQuery) {
                    // This is a first-level extra. It must exist in the configuration.
                    req.hNordis.sPath = '/'+req.hNordis.sClass.toLowerCase()+'/{id}/'+sItem;

                    sConfClass = AppConfig.hClassMap[req.hNordis.sClass.toLowerCase()+'.'+sItem];

                    try {
                        hEndpoint = AppConfig.hClasses[sConfClass].hApi.hEndpoints[req.hNordis.sPath].hVerbs[req.method]
                    } catch(err) {}

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
                }

                break;
        }
    });

    var passItOn = function(err,hResult) {
        if (err) {
            AppConfig.error(err);
            req.hNordis.sException = err;
        }
        AppConfig.silly(req.hNordis);

        req.hNordis.hResult = hResult;
        fnCallback(err);
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
                    Base.lookup({sClass:req.hNordis.sClass,hQuery:req.hNordis.hQuery},cb);
                }
                ,function(oResult,cb){
                    req.hNordis.oResult = oResult;
                    AppConfig.debug('FOUND oResult: '+oResult.sClass+' ('+oResult.getKey()+')');

                    // Before loading any extras, check the endpoint configuration for an override boolean.
                    if (!hEndpoint.bDisallowExtras && req.hNordis.oResult && req.hNordis.hExtras) {
                        AppConfig.debug('Loading Extras---');
                        AppConfig.debug(req.hNordis.hExtras);

                        req.hNordis.oResult.loadExtras(req.hNordis.hExtras,cb);

                    } else
                        cb(null,null);
                }
                // Check for fnApiCallProcessor, through which you can write a completely custom handler for setting properties, checking security, and tracking stats.
                // Otherwise, just call setData on POST requests or pass through if not.
                ,function(oResult,cb) {
                    // If the endpoint included an extra in the path, then the user wants that extra to be the root of the document. Switch to it.
                    if (oResult) {
                        if (req.hNordis.sExtra) {
                            req.hNordis.oResult = oResult[req.hNordis.sExtra];
                            // The hExtras used for serialization starts at the sExtra:
                            req.hNordis.hExtras = req.hNordis.hExtras[req.hNordis.sExtra].hExtras || true;
                        } else
                            req.hNordis.oResult = oResult;
                    }


                    if (!req.hNordis.oResult)
                        cb(null,null);
                    else if (hEndpoint.fnApiCallProcessor)
                        hEndpoint.fnApiCallProcessor(req,AppConfig,function(err){
                            cb(err,req.hNordis.oResult);
                        });
                    else {
                        if (req.method=='POST')
                            // We don't actually call save here. That is done in the apiParser method. preParse only gets the object ready to save. You, of course, can save it in your custom fnValidate function.
                            req.hNordis.oResult.setData(req.body);

                        cb(null,req.hNordis.oResult);
                    }
                }
                // Allow user to customize API output (serialization) if desired.
                ,function(oResult,cb) {
                    if (!req.hNordis.oResult)
                        cb(null,null);
                    else if (hEndpoint.fnApiCallOutput)
                        hEndpoint.fnApiCallOutput(req,AppConfig,cb);
                    else
                        cb(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
                }
            ],function(err,hResult){
                passItOn(err,hResult);
            });
        }
    }
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
};