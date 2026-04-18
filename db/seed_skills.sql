-- Optional seed for local dev (run after schema.sql).
USE student_collab;

INSERT IGNORE INTO skills (name) VALUES
  ('JavaScript'),
  ('TypeScript'),
  ('Python'),
  ('Java'),
  ('C++'),
  ('React'),
  ('Node.js'),
  ('UI/UX design'),
  ('Machine learning'),
  ('Data analysis'),
  ('DevOps'),
  ('Mobile development'),
  ('Technical writing'),
  ('Project management');
