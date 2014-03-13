var async       = require('async'),
    request     = require('request'),
    moment      = require('moment'),
    AppConfig   = require('./../../lib/AppConfig'),
    Base        = require('./../../lib/Base');

AppConfig.init(function(){
    var user = Base.lookup({sClass:'User'});
    user.set('balance',4.5);

    console.log(user.get('balance'));
});
