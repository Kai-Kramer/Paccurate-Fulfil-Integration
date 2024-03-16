# What is this?
[Cartonization](https://paccurate.io/what-is-cartonization) is the process by which items in an order are placed into the best package(s), often to minimize shipping costs and time spent packing. This is a (somewhat) small script that implements Cartonization for the [Fulfil ERP](https://www.fulfil.io/). Cartonization is performed by [Paccurate](https://paccurate.io).

# Usage
This is a small monolith because it lives in an AWS Lambda. The script expects an environmental variable, `PACCURATE_KEY` as well as a database connection for cachine product details. There are a handful of exceptions and special cases that have been added to this script to cater to this client's needs. If you are looking to use this as a reference, however, the relevant functions will ikely be `_FulfilToPaccurate` and `_PaccurateToFulfil`.

# Relevant Documentation
[Paccurate -- Schema](http://api.paccurate.io/docs/)

[Fulfil.io -- Cartonization](https://docs.fulfil.io/developers/other-apis/cartonization/#response-object) (requires login)
