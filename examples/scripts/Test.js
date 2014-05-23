var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    Stats       = require('./../../lib/Utils/Stats'),
    AppConfig   = require('./../../lib/AppConfig'),
    Base        = require('./../../lib/Base');

var nTestSize = 100;

AppConfig.init(function(){
    Base.lookupP({sClass:'User',hQuery:{id:140591}})
        .then(function(hResult){
            console.log(hResult);
        },function(err){
            AppConfig.error(err);
        })
        .done(AppConfig.exit);
});

