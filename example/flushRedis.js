var App     =   require('./../lib/AppConfig');

process.env.sApp = 'flushRedis.js';
/**
 * This deletes everything in redis!! Don't screw with it.
 */
var hStats = {pDone:'0%'};

App.Redis.acquire(function(err,oClient){
    oClient.keys('*',function(err,aKeys){
        var nFound = 0;

        var multi = oClient.multi();
        for (var i=0; i < aKeys.length; i++) {
            // We need to preserve the nSeedID key so we don't overwrite anything in mysql.
            var aMatches = aKeys[i].match(new RegExp(/(nSeedID|sess\:)/i));
            if (!aMatches) {
                App.info('Del: '+aKeys[i]);
                multi.del(aKeys[i]);
                nFound++;
            }
        }

        if (nFound > 0) {
            App.info('Executing multi-delete ('+nFound+')....');
            multi.exec(function(){
                App.info('DONE');
                App.Redis.release(oClient);
                App.exit();
            });
        } else {
            App.Redis.release(oClient);
            App.info('Nothing to do.');
            App.exit();
        }
    });
})
