var AppConfig     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base');

AppConfig.init(null,function(){
    //AppConfig.trace(1,'hey');
    AppConfig.trace(1,{2:'foo'});
    AppConfig.trace(1,{3:'bar'});
    console.log(AppConfig.hTrace);
});