var async       = require('async'),
    Collection  = require('./../../lib/Collection'),
    Base        = require('./../../lib/Base'),
    AppConfig   =   require('./../../lib/AppConfig');

process.env.sApp = 'rebuildRedis.js';
/**
 * This script rebuilds Redis with all the data from MySql.
 */

var processClass = function(sClass,callback) {
    AppConfig.log('Processing '+sClass);

    // Create an hExtras document with which we'll retrieve each record for the class and it's entire document.
    var hExtras = {};
    if (AppConfig.hClasses[sClass].hExtras)
        for (var sExtra in AppConfig.hClasses[sClass].hExtras) {
            hExtras[sExtra] = true;
        }
    var hQuery = {};
    hQuery[AppConfig.hClasses[sClass].sNumKeyProperty||AppConfig.hClasses[sClass].sStrKeyProperty] = 'IS NOT NULL';

    // Lookup each item in the class.
    new Collection({sClass:sClass,hQuery:hQuery,hExtras:hExtras},function(err,coll){
        if (err || !coll.nTotal)
            callback(err);
        else {
            async.forEach(coll.aObjects,function(oObj,cb){
                AppConfig.log(sClass+': '+oObj.getKey());

                async.parallel([
                    function(cb2) {
                        oObj.save({bForce:true},cb2);
                    }
                    ,function(cb2) {
                        var qExtras = async.queue(function(sExtra,cb3){

                            AppConfig.log('Extra: '+sExtra);

                            if (oObj[sExtra]) {
                                if (oObj[sExtra] instanceof Collection) {
                                    oObj.setExtra(sExtra,oObj[sExtra],cb3);
                                } else {
                                    async.forEach(oObj[sExtra].aObjects,function(oItem,cb4){
                                        oObj.setExtra(sExtra,oItem,cb4);
                                    },3);
                                }
                            }

                        },3);
                        qExtras.drain = cb2;

                        for (var sExtra in hExtras) {
                            qExtras.push(sExtra);
                        }
                    }
                ],cb);

            },callback);
        }
    });
};

var q = async.queue(processClass,3);
q.drain = function(){
    AppConfig.log('All done!');
    AppConfig.exit();
}

for (var sClass in AppConfig.hClasses) {
    q.push(sClass);
}