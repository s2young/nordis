var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    AppConfig   = require('./../../lib/AppConfig'),
    Base        = require('./../../lib/Base');

AppConfig.init(function(){
    AppConfig.processStats(function(err){
        if (err)
            AppConfig.error(err);

        console.log('done');
        AppConfig.exit();
    });
});
