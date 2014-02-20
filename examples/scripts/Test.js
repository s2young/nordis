var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    AppConfig   = require('./../../lib/AppConfig'),
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
            var hour = Math.floor(Math.random()*23);
            var date = Math.floor(Math.random()*27);
            var month = Math.floor(Math.random()*11);
            aDates.push(moment({month:month,date:date,hour:hour}));
            n++;
        }
        async.forEach(aDates,function(date,cb){
            //Simulate homepage hit.
            AppConfig.trackStat('hits',['/'],cb,date.toDate());
            if (date.hour() % 2)
                AppConfig.trackStat('hits',['/'],null,date.toDate());

        },callback);
    }
    //Process stats .
    ,function(callback){
        AppConfig.processStats(callback);
    }
],function(err){
    if (err)
        AppConfig.error(err);

    //server.close();
    AppConfig.exit();
});
