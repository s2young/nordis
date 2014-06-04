var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    AppConfig   = require('./../../lib/AppConfig'),
    Base        = require('./../../lib/Base');

AppConfig.init(function(){
    Base.lookup({sClass:'User',hQuery:{id:'186961'},hExtras:{follows:{hExtras:{follower_user:true}}}},function(err,user){
        if (err)
            AppConfig.error(err);
        else
            console.log(user);

        console.log(AppConfig.get('MySql').hTrace);
    })
});

