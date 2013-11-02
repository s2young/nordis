var App     =   require('./../lib/AppConfig');

process.env.sApp = 'keysInRedis.js';
/**
 * Spits out a list of all the keys in redis.
 */
App.Redis.acquire(function(err,oClient){
    oClient.keys('*',function(err,aKeys){
        var nFound = 0;

        for (var i=0; i < aKeys.length; i++) {
            console.log(aKeys[i]);
        }

        App.Redis.release(oClient);
        App.exit();
    });
});