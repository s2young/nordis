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

        Base.lookup({sClass:'User',hQuery:{id:'1234'}},function(err,oUser){
            if (err)
                Config.error(err);

            console.log(oUser);
            Config.exit();
        })

    }
});