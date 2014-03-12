var Base = require('nordis').Base,
    App = require('nordis').AppConfig;


// Initialize your app. You may either set your environment variables or pass them into the init method.
App.init({
    NORDIS_ENV_ROOT_DIR:__dirname // This is a one-directory project so we're already in the root.
    ,NORDIS_ENV_CONF:__dirname+'/conf.js' // The conf.js
    ,NORDIS_ENV:'local' // I use local, dev and prod here, but it is used in overriding settings in conf.js.
},function(err){
    // You should be ready to create or lookup a user now.

    Base.lookup({sClass:'User',hQuery:{email:'john@gmail.com'}},function(err,user){
        if (err)
            App.error(err);
        else {
            App.info('User lookup result: '+user.getKey());

            user.set('name','Johnny');
            user.set('email','john@gmail.com');
            user.save(function(err){
                App.info('User save result: '+user.getKey());
                App.exit();
            });
        }
    })
});
