var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    Stats       = require('./../../lib/Utils/Stats'),
    AppConfig   = require('./../../lib/AppConfig'),
    Base        = require('./../../lib/Base');

var nTestSize = 100;

AppConfig.init(function(){
    Stats.process(function(err){
        if (err)
            AppConfig.error(err);
        else
            AppConfig.exit();
    });
});

