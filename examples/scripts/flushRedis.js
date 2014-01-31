var async   = require('async'),
    AppConfig     =   require('./../../lib/AppConfig');

process.env.sApp = 'flushRedis.js';
/**
 * This deletes everything in redis, except the nSeedID which Nordis uses to hand out primary key ids. Don't remove that key! If you do you'll need to find the highest primary key id in your data
 * set and reset the nSeedID key.
 */
AppConfig.Redis.acquire(function(err,oClient){
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
            AppConfig.exit();
        }
    });
});
