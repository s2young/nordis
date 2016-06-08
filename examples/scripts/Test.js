var async       = require('async'),
    request     = require('request'),
    should      = require('should'),
    Mongo       = require('./../../lib/Utils/Data/Mongo'),
    express     = require('express'),
    Base        = require('./../../lib/Base'),
    Config      = require('./../../lib/AppConfig'),
    Metric      = require('./../../lib/Metric');


Config.init(function(err){
    if (err)
        console.error(err);
    else {

        Mongo.init(Config.hOptions.Mongo);

        Base.lookup({sClass:'User',hQuery:{email:'stuart@younghome.net'}},function(err,oObj){

            oObj.set('name','Stu');
            oObj.set('email','stuart@younghome.net');
            //oObj.set('email','s2.d.young@gmail.com');

            if (oObj.getKey()) {
                console.log('delete',oObj);
                oObj.delete(function(err){
                    console.log(err);
                    Config.exit();
                });
            } else
                oObj.save(function(err){
                    console.log(oObj);
                    console.log(err);
                    Config.exit();
                });

        });

    }
});