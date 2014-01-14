var AppConfig     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base');

AppConfig.init(null,function(){
    Base.lookup({sClass:'App',hExtras:{unique_users:{hExtras:{day:true}}}},function(err,oApp){
        console.log(oApp);
        AppConfig.exit();
    });
});
