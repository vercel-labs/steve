// Seed dataset for the agent's sandbox: a small, recognizable movie database.
//
// These are real, well-known films so anyone can sanity-check the agent's
// answers by eye (e.g. "Inception is 2010", "Titanic made ~$2.2B") without
// trusting the math blindly. Figures are approximate, rounded public numbers
// (release year, runtime in minutes, budget and worldwide box office in USD,
// IMDb-style rating). They're "semi-realistic" reference data, not authoritative.
//
// Written into /workspace/movies.csv at the start of each sandbox session
// (see sandbox.ts), so the agent has data to analyze immediately.
export const MOVIES_CSV = `title,year,director,genre,runtime_min,budget_usd,box_office_usd,rating
The Shawshank Redemption,1994,Frank Darabont,Drama,142,25000000,73300000,9.3
The Godfather,1972,Francis Ford Coppola,Crime,175,6000000,250300000,9.2
The Dark Knight,2008,Christopher Nolan,Action,152,185000000,1006000000,9.0
Pulp Fiction,1994,Quentin Tarantino,Crime,154,8000000,213900000,8.9
Forrest Gump,1994,Robert Zemeckis,Drama,142,55000000,678200000,8.8
Inception,2010,Christopher Nolan,SciFi,148,160000000,836800000,8.8
The Matrix,1999,The Wachowskis,SciFi,136,63000000,467200000,8.7
Goodfellas,1990,Martin Scorsese,Crime,145,25000000,46800000,8.7
Interstellar,2014,Christopher Nolan,SciFi,169,165000000,701700000,8.7
The Lord of the Rings: The Return of the King,2003,Peter Jackson,Fantasy,201,94000000,1146000000,9.0
Fight Club,1999,David Fincher,Drama,139,63000000,101200000,8.8
The Lord of the Rings: The Fellowship of the Ring,2001,Peter Jackson,Fantasy,178,93000000,887800000,8.9
Star Wars: A New Hope,1977,George Lucas,SciFi,121,11000000,775400000,8.6
Titanic,1997,James Cameron,Romance,194,200000000,2202000000,7.9
Avatar,2009,James Cameron,SciFi,162,237000000,2923000000,7.9
Gladiator,2000,Ridley Scott,Action,155,103000000,460500000,8.5
Jurassic Park,1993,Steven Spielberg,Adventure,127,63000000,1037000000,8.2
Saving Private Ryan,1998,Steven Spielberg,War,169,70000000,482300000,8.6
Schindler's List,1993,Steven Spielberg,Drama,195,22000000,322200000,9.0
The Lion King,1994,Roger Allers,Animation,88,45000000,968500000,8.5
Toy Story,1995,John Lasseter,Animation,81,30000000,394400000,8.3
Finding Nemo,2003,Andrew Stanton,Animation,100,94000000,940300000,8.2
The Avengers,2012,Joss Whedon,Action,143,220000000,1519000000,8.0
Avengers: Endgame,2019,Anthony Russo,Action,181,356000000,2799000000,8.4
Iron Man,2008,Jon Favreau,Action,126,140000000,585800000,7.9
Joker,2019,Todd Phillips,Drama,122,55000000,1074000000,8.4
Parasite,2019,Bong Joon-ho,Thriller,132,11400000,258700000,8.5
Whiplash,2014,Damien Chazelle,Drama,107,3300000,49000000,8.5
La La Land,2016,Damien Chazelle,Romance,128,30000000,447400000,8.0
Mad Max: Fury Road,2015,George Miller,Action,120,150000000,375200000,8.1
The Departed,2006,Martin Scorsese,Crime,151,90000000,291500000,8.5
Django Unchained,2012,Quentin Tarantino,Western,165,100000000,426100000,8.5
The Prestige,2006,Christopher Nolan,Mystery,130,40000000,109700000,8.5
Back to the Future,1985,Robert Zemeckis,SciFi,116,19000000,388800000,8.5
Alien,1979,Ridley Scott,Horror,117,11000000,184700000,8.5
The Silence of the Lambs,1991,Jonathan Demme,Thriller,118,19000000,272700000,8.6
Spirited Away,2001,Hayao Miyazaki,Animation,125,19000000,395800000,8.6
Get Out,2017,Jordan Peele,Horror,104,4500000,255500000,7.7
Dune,2021,Denis Villeneuve,SciFi,155,165000000,402000000,8.0
Oppenheimer,2023,Christopher Nolan,Drama,180,100000000,975800000,8.3
Barbie,2023,Greta Gerwig,Comedy,114,145000000,1446000000,6.8
Everything Everywhere All at Once,2022,Daniel Kwan,SciFi,139,25000000,143400000,7.8
`;
