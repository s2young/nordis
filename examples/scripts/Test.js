var AppConfig     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base');

AppConfig.init(null,function(){
    Base.lookup({sClass:'User',hQuery:{id:123}},function(err,user){
        console.log(user);
    });
});