var async       = require('async'),
    Base        = require('./../../lib/Base'),
    Collection  = require('./../../lib/Collection'),
    AppConfig   = require('./../../lib/AppConfig');


var maxed = 0;
async.series([
    // Reset maxmemory to 0 before flushing.
    function(cb) {
        AppConfig.Redis.acquire(function(err,oClient){
            oClient.config('set','maxmemory',0,cb);
        });
    }
    // Flush out users from previous runs.
    ,function(cb) {
        console.log('Flush users from previous runs.');
        new Collection({sClass:'User',hQuery:{sWhere:'email LIKE \'%@test.com\''}},function(err,cColl){
            if (err)
                cb(err);
            else
                cColl.delete(cb);
        });
    }
    ,function(callback){
        console.log('Limit maxmemory.');
        AppConfig.Redis.acquire(function(err,oClient){
            oClient.config('set','maxmemory',2048000,callback);
        });
    }
    ,function(callback) {
        console.log('Attempt to max out.');
        var q = [];
        for (var i = 0; i < 10000; i++) {
            q.push(i);
        }
        async.forEachLimit(q,1,function(n,cb){
            if (!maxed) {
                var user = Base.lookup({sClass:'User'});
                user.set('name','TestUser');
                user.set('email','test'+n+'@test.com');
                user.save(function(err){
                    if (err) {
                        maxed = n;
                        console.log('Maxed out at '+maxed);
                        cb('Maxed out at '+maxed);
                    } else
                        cb();
                });
            } else
                cb();
        },callback);
    }

],function(err){
    AppConfig.exit();
});