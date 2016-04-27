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

        Base.lookup({sClass:'Metric',hQuery:{nID:111339}},function(err,oRes){
            console.error(err);
            console.log(oRes);
        });

    }
});