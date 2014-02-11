var AppConfig     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base');

AppConfig.init(null,function(){
    Base.lookup({sClass:'App'},function(err,app){
        console.log(app);
    });
});