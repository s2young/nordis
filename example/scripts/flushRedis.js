var async   = require('async'),
    App     =   require('./../../lib/AppConfig');

process.env.sApp = 'flushRedis.js';
/**
 * This deletes everything in redis!! Don't screw with it.
 */
App.Redis.acquire(function(err,oClient){
    oClient.keys('*',function(err,aKeys){
        var nFound = 0;

        var flushKey = function(sKey,callback) {
            if (sKey)
                oClient.del(sKey,callback);
            else
                callback();
        };

        var q = async.queue(flushKey,100000);
        for (var i=0; i < aKeys.length; i++) {
            // We need to preserve the nSeedID key so we don't overwrite anything in mysql.
            var aMatches = aKeys[i].match(new RegExp(/(nSeedID|sess\:)/i));
            if (!aMatches) {
                console.log(aKeys[i]);
                q.push(aKeys[i]);
            } else
                q.push('');
        }

        q.drain = function(){
            console.log('All done.');
            App.exit();
        }
    });
})
