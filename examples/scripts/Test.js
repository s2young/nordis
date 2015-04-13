var async       = require('async'),
    request     = require('request'),
    should      = require('should'),
    express     = require('express'),
    Base        = require('./../../lib/Base'),
    Config      = require('./../../lib/AppConfig'),
    Metric      = require('./../../lib/Metric');


Config.init(function(err){
    if (err)
        console.error(err);
    else {

        Metric.flush(function(err){
            if (err)
                Config.error(err);


            Config.exit();
        })

    }
});