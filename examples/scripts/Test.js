var AppConfig     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base');

AppConfig.init(null,function(){
    var user = Base.lookup({sClass:'User'});
    user.set('email','test@gmail.com');
    user.save(function(err){
        console.log(err);

    });
});
