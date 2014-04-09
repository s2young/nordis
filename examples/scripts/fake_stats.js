var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    AppConfig   = require('./../../lib/AppConfig'),
    Stats       = require('./../../lib/Utils/Stats'),
    Base        = require('./../../lib/Base');

var nTestSize = 100;

async.series([
    function(callback) {
        AppConfig.init(callback);
    }
    // Fake some stat counts using random dates.
    ,function(callback) {
        var aDates = [];
        var n = 0;
        while (n < nTestSize) {
            var daysback = Math.floor(Math.random()*365);
            var date = moment().subtract('days',daysback);
            aDates.push(date);
            n++;
        }
        async.forEach(aDates,function(date,cb){
            //Simulate homepage hit.
            Stats.track({
                sStat:'hits',
                Params:'/',
                dDate:date.toDate(),
                nFakeCount:Math.floor(Math.random()*100)
            },cb);

        },callback);
    }
    //Process stats .
    ,function(callback){
        Stats.process(callback);
    }
],function(err){
    if (err)
        AppConfig.error(err);

    //server.close();
    AppConfig.exit();
});
