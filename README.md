nordis
=====

Node.js framework for rapid web application and API development that utilizes the speed of Redis without sacrificing the piece
of mind provided by a relational database.

Nordis Highlights:
-------------

### 1. Code-first.
Define your model in the configuration file and then go to work. Nordis will save data to Redis, as well as create tables and columns in MySql for you. Here is a snippet of the included, example configuration file that defines the 'User' class:

```
    User:{
        // Each class is assigned a number for namespacing in redis.
        nClass:1
         // Properties can be mapped to existing tables and columns, but this assumes a clean slate
        hProperties:{
            id:{sType:'Number',bUnique:true,sSample:'1'}
            ,sid:{sType:'String',bUnique:true,nLength:36,sSample:'Yf8uIoP'}
            ,name:{sType:'String',sSample:'Joe User'}
            ,password:{sType:'String',bPrivate:true,sSample:'password'}
            ,email:{sType:'String',bUnique:true,sSample:'joe@gmail.com'}
            ,referrer_id:{sType:'Number',sSample:null}
        }
        // This is where you define related objects and collections.
        ,hExtras:{
            friends:{
                sType:'Collection'
                ,sClass:'Friend'
                ,sOrderBy:'rank' // rank is a property on the Friend class, by which we sort the user.friends collection.
                ,bReverse:true // rank is ordered largest to smallest.
                ,fnQuery:function(oSelf){
                    // If we need to pull the collection from MySql, this returns the query bits needed to do so.
                    return {user_id:oSelf.getKey()}
                }
            }
            ,referring_user:{
                sType:'Object'
                ,sClass:'User'
                ,aKey:['referrer_id','id']
                ,fnQuery:function(oObj){
                    return {id:oObj.get('referrer_id')}
                }
            }
        }
    }
```

2. Redis + MySql as DB. Nordis stores objects in both Redis and MySql and will always pull from Redis first if the object is available,
unless you specify otherwise in your code. This means consistently fast look-ups without losing the peace-of-mind that
a relational db provides.  Plugins for Postgres and other relational dbs shouldn't be too hard to add over time.

3. Nested Property Lookups. Almost never does a resource exist in a model without relationships with other resources. Twitter users,
for example, have followers. Nordis allows you to retrieve a complex document relating to the resource including collections of
 data (a list of followers, for example; or just the first page of followers).

4. Base Class. The Nordis base class provides all your CRUD boilerplate methods. You can create your own custom modules that extend
the Base class.

5. Collection Class. The Nordis collection provides support for getting paged data easily, as well as getting the total number of
items in the collection regardless of the size of the page you request. Collections are defined in configuration, including how they
are sorted and the query parameters required to pull the collection directly from MySql. They are stored in Redis using Redis'
Sorted Set data type, a powerful and fast tool for storing collections. Again, if the data isn't in Redis we'll check MySql.

6. API Boilerplate & Apiary Docs. Nordis is packaged with the ability to create a RESTful API by defining endpoints in your config file
and utilizing the provided expressjs Middleware functions. The parser middleware performs all the CRUD exposed in the API, while
the pre-parser only looks up the desired resource and sets properties on the resource (in the case of updates) but does NOT
save the resource. There are a couple of hooks you can add to any api call to customize the output, track stats, check security, etc.
You can, of course, bypass this middleware completely and build your own API. By defining the API in config,
however, you can leverage the packaged apiary.js script which outputs API documentation for use over at apiary.io. Your choice.





