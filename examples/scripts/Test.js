var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    AppConfig   = require('./../../lib/AppConfig'),
    Base        = require('./../../lib/Base');

Base.lookupP({sClass:'User',hQuery:{id:150603},hExtras:{follows:true}})
    .then(function(user){
        console.log(user);
    },function(err){throw err});
