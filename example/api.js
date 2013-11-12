var express     = require('express'),
    App         = require('./../lib/AppConfig'),
    Middleware  = require('./../lib/Utils/Middleware');

process.env.sApp = 'api';

App.init(null,function(){
    var exp_app = express();
    exp_app.listen(2002);
    exp_app.use(express.bodyParser());
    exp_app.use(Middleware.apiParser);
})
