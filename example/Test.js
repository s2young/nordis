var App     = require('./../lib/AppConfig'),
    Base    = require('./../lib/Base');

App.init(null,function(){
    var user = Base.lookup({sClass:'User'});
    user.set('name','TestUser');
    user.set('email','test@test.com');
    user.save(null,function(err){
        if (err)
            App.error(err);

        console.log(user);
        App.exit();
    });

});
