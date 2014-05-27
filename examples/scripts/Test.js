var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    Stats       = require('./../../lib/Utils/Stats'),
    AppConfig   = require('./../../lib/AppConfig'),
    Base        = require('./../../lib/Base');

var nTestSize = 100;

AppConfig.init(function(){
    Base.lookup({sClass:'User',hQuery:{id:'186961'},hExtras:{follows:{hExtras:{follower_user:true}}}},function(err,user){
        if (err)
            AppConfig.error(err);
        else
            console.log(user);

        console.log(AppConfig.MySql.hTrace);
    })
});

