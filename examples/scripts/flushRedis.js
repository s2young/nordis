var AppConfig   = require('./../../lib/AppConfig'),
    async       = require('async');

/**
 * This deletes everything in redis!! Don't screw with it.
 */
var aFound = [];

var deleteKeys = function(oClient,fnCallback) {
    oClient.keys('*',function(err,aKeys){
        console.log('FOUND '+aKeys.length+' IN REDIS ON '+oClient.sDbAlias+'.');
        if (!aKeys.length) {
            fnCallback();
        } else
            async.forEachLimit(aKeys,20,function(sKey,callback){
                console.log(sKey);
                console.log(sKey.match(/nSeedID/));
                if (!sKey.match(/nSeedID/)) {
                    AppConfig.info('Del: '+sKey);
                    aFound.push(1);
                    oClient.del(sKey,callback);
                } else
                    callback();
            },fnCallback);
    });
};

AppConfig.init(null,function(){
    async.series([
        function(callback) {
            AppConfig.Redis.acquire(function(err,oClient){
                deleteKeys(oClient,callback);
            },'default');
        }
        ,function(callback) {
            AppConfig.Redis.acquire(function(err,oClient){
                deleteKeys(oClient,callback);
            },'statsdb');
        }
    ],function(err){
        if (err) AppConfig.error(err);

        AppConfig.info('REMOVED '+aFound.length+' KEYS');
        AppConfig.exit();
    });
});
