var App     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base');

App.init(null,function(){
    Base.lookup({sClass:'App'},function(err,oApp){
        console.log(oApp);
    });
});
