nordis
=====

Bare-bones framework for rapid web application development that scales with you.

Nordis Highlights:

1. Code-first. You define your model in the configuration file and then go to work. Nordis will save data to Redis, as well as create tables
and columns in MySql for you.

2. Redis as DB. Nordis stores objects in both Redis and MySql and will always pull from Redis first if the object is available,
unless you specify otherwise in your code. This means consistently fast look-ups without losing the peace-of-mind that
a relational db provides.  I definitely would like to add support for other dbs over time.

3. Base class. Nordis objects include convenient methods to save, delete and serialize. You can override the Base class
to add custom methods. You can also attach an adapter that is triggered post-db call, so you can respond to a new/removed/changed
  object.

4. Collection class. Nordis collections make it easy to iterate, page, and serialize objects. These features extend to REST calls
to the built-in API.

5. Extended properties on objects. Define objects or collections that exist as properties on other objects,
and you immediately have the ability to store and retrieve those objects and collections along with the parent object to
which they belong - in a single line of code. This feature extends to the REST API as well.

6. API-in-config. The configuration file also supports API definition so you can quickly create a REST API for your model. In
addition, Nordis includes an apiary.js script that outputs the contents of the configuration into Apiary.io-compatible API documentation.



