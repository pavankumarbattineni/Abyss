FROM python:3.11.6

WORKDIR /code

COPY requirements.txt .

RUN pip install --upgrade pip
RUN pip install -r requirements.txt

COPY . .
RUN ls -l
RUN chmod +x gunicorn_starter.sh

EXPOSE 8000

ENTRYPOINT ["./gunicorn_starter.sh"]